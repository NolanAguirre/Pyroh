#!/usr/bin/env python3
"""Local LLM categorizer consumer.

Drains QUEUE_DIR while holding the GPU flock at GPU_LOCK_PATH: loads LLM_MODEL
once per batch, runs each job through its TASKS entry, writes the result back
into the descriptor, POSTs { task, key, result } to the job's callback, then
unloads the model so VRAM is free for the other GPU services.

Debug one-shot (also takes the GPU lock):

    consumer.py --task chat-name "text to name"

Prefetch the weights (make install.model):

    consumer.py --download
"""

import argparse
import gc
import json
import os
import re
import sys
import tempfile
import urllib.request

import fsqueue

DEFAULT_MODEL = os.environ.get("LLM_MODEL", "Qwen/Qwen3-4B-Instruct-2507")
DEFAULT_QUANT = os.environ.get("LLM_QUANT", "4bit")
DEFAULT_MAX_MEMORY = os.environ.get("LLM_MAX_MEMORY", "6GiB")
CALLBACK_TIMEOUT_SECONDS = 10

TITLE_QUOTES = "\"'`\u201c\u201d\u2018\u2019*"
TITLE_TRAILING = ".,;:!?-\u2013\u2014 "
TITLE_MAX_CHARS = 60


def clean_title(text):
    line = ""
    for candidate in text.splitlines():
        if candidate.strip():
            line = candidate.strip()
            break
    line = re.sub(r"^(title|chat name|name)\s*:\s*", "", line, flags=re.IGNORECASE)
    line = line.strip(TITLE_QUOTES + " ")
    line = re.sub(r"\s+", " ", line).rstrip(TITLE_TRAILING).strip(TITLE_QUOTES + " ")
    if len(line) > TITLE_MAX_CHARS:
        cut = line[:TITLE_MAX_CHARS]
        space = cut.rfind(" ")
        line = (cut[:space] if space > TITLE_MAX_CHARS // 2 else cut).rstrip(TITLE_TRAILING)
    if not line:
        raise ValueError("model returned an empty title")
    return line


TASKS = {
    "chat-name": {
        "system": (
            "You name chat sessions. Read the user's first message to a coding "
            "assistant and reply with a short title of 3 to 6 words that "
            "describes the task. Reply with the title only: no quotes, no "
            "trailing punctuation, no explanation."
        ),
        "max_input_chars": 2000,
        "max_new_tokens": 24,
        "postprocess": clean_title,
    },
    "terminal-name": {
        "system": (
            "You name terminal tabs. Read the shell command a developer just "
            "ran and reply with a short title of 1 to 4 words that describes "
            "what the terminal is being used for, such as Dev Server, Git "
            "Rebase or Docker Logs. Reply with the title only: no quotes, no "
            "trailing punctuation, no explanation."
        ),
        "max_input_chars": 1000,
        "max_new_tokens": 16,
        "postprocess": clean_title,
    },
}


class Handler:
    def __init__(self, queue_dir=None, model_id=DEFAULT_MODEL, quant=DEFAULT_QUANT, max_memory=DEFAULT_MAX_MEMORY):
        self.queue_dir = queue_dir
        self.model_id = model_id
        self.quant = quant
        self.max_memory = max_memory
        self.model = None
        self.tokenizer = None

    def load(self):
        import torch
        from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig

        if not torch.cuda.is_available():
            raise RuntimeError("CUDA is not available")

        kwargs = {
            "device_map": "auto",
            "max_memory": {0: self.max_memory},
            "torch_dtype": torch.bfloat16,
        }
        if self.quant == "4bit":
            kwargs["quantization_config"] = BitsAndBytesConfig(
                load_in_4bit=True,
                bnb_4bit_quant_type="nf4",
                bnb_4bit_compute_dtype=torch.bfloat16,
                bnb_4bit_use_double_quant=True,
            )
        elif self.quant == "8bit":
            kwargs["quantization_config"] = BitsAndBytesConfig(load_in_8bit=True)
        elif self.quant not in ("", "none"):
            raise ValueError("unsupported LLM_QUANT: " + self.quant)

        sys.stderr.write("loading " + self.model_id + " (" + (self.quant or "none") + ")\n")
        sys.stderr.flush()
        self.tokenizer = AutoTokenizer.from_pretrained(self.model_id)
        self.model = AutoModelForCausalLM.from_pretrained(self.model_id, **kwargs)
        self.model.eval()

    def unload(self):
        self.model = None
        self.tokenizer = None
        gc.collect()
        try:
            import torch

            if torch.cuda.is_available():
                torch.cuda.empty_cache()
        except ImportError:
            pass
        gc.collect()

    def generate(self, task_name, text):
        import torch

        task = TASKS.get(task_name)
        if task is None:
            raise ValueError("unknown task: " + str(task_name))
        if not isinstance(text, str) or not text.strip():
            raise ValueError("input is empty")

        messages = [
            {"role": "system", "content": task["system"]},
            {"role": "user", "content": text.strip()[: task["max_input_chars"]]},
        ]
        inputs = self.tokenizer.apply_chat_template(
            messages,
            add_generation_prompt=True,
            return_dict=True,
            return_tensors="pt",
        ).to(self.model.device)
        pad_token_id = self.tokenizer.pad_token_id
        if pad_token_id is None:
            pad_token_id = self.tokenizer.eos_token_id

        with torch.inference_mode():
            output = self.model.generate(
                **inputs,
                max_new_tokens=task["max_new_tokens"],
                do_sample=False,
                temperature=None,
                top_p=None,
                top_k=None,
                pad_token_id=pad_token_id,
            )
        prompt_length = inputs["input_ids"].shape[1]
        raw = self.tokenizer.decode(output[0][prompt_length:], skip_special_tokens=True)
        return task["postprocess"](raw)

    def _write_result(self, descriptor, result):
        # Rewrite the processing descriptor atomically so GET /jobs/:id never
        # sees a partial file; fsqueue then moves it to done/ or failed/.
        record = {key: value for key, value in descriptor.items() if not key.startswith("_")}
        record["result"] = result
        tmp_dir = os.path.join(self.queue_dir, "tmp")
        os.makedirs(tmp_dir, exist_ok=True)
        fd, tmp_path = tempfile.mkstemp(dir=tmp_dir, prefix=descriptor["_name"] + ".", suffix=".result")
        try:
            with os.fdopen(fd, "w") as handle:
                json.dump(record, handle)
            os.replace(tmp_path, descriptor["_path"])
        except BaseException:
            fsqueue.remove_temp(tmp_path)
            raise

    def _callback(self, descriptor, result):
        callback = descriptor.get("callback")
        if not callback or not callback.get("url"):
            return
        body = json.dumps({
            "task": descriptor.get("task"),
            "key": descriptor.get("key"),
            "result": result,
        }).encode("utf-8")
        request = urllib.request.Request(
            callback["url"],
            data=body,
            method=callback.get("method") or "POST",
            headers={"Content-Type": "application/json", "User-Agent": "categorizer"},
        )
        with urllib.request.urlopen(request, timeout=CALLBACK_TIMEOUT_SECONDS) as response:
            status = getattr(response, "status", 200)
            if status < 200 or status >= 300:
                raise ValueError("callback returned status " + str(status))

    def process(self, descriptor):
        result = self.generate(descriptor.get("task"), descriptor.get("input"))
        self._write_result(descriptor, result)
        self._callback(descriptor, result)
        sys.stderr.write(str(descriptor.get("_name")) + " -> " + result + "\n")
        sys.stderr.flush()


def run_once(task, text):
    lock_path = os.environ.get("GPU_LOCK_PATH")
    if not lock_path:
        sys.exit("GPU_LOCK_PATH is not set")
    handler = Handler()
    lock_handle = fsqueue.acquire_lock(lock_path)
    try:
        handler.load()
        try:
            print(handler.generate(task, text))
        finally:
            handler.unload()
    finally:
        fsqueue.release_lock(lock_handle)


def download():
    from huggingface_hub import snapshot_download

    sys.stderr.write("downloading " + DEFAULT_MODEL + " into the Hugging Face cache\n")
    sys.stderr.flush()
    snapshot_download(DEFAULT_MODEL)


def main():
    parser = argparse.ArgumentParser(description="Local LLM categorizer consumer")
    parser.add_argument("--task", choices=sorted(TASKS), help="Run one task on TEXT and print the result")
    parser.add_argument("--download", action="store_true", help="Download LLM_MODEL weights and exit")
    parser.add_argument("text", nargs="?", help="Input text for --task")
    args = parser.parse_args()

    if args.download:
        download()
        return

    if args.task:
        if not args.text:
            parser.error("--task needs TEXT")
        run_once(args.task, args.text)
        return

    queue_dir = os.environ.get("QUEUE_DIR")
    lock_path = os.environ.get("GPU_LOCK_PATH")
    if not queue_dir:
        sys.exit("QUEUE_DIR is not set")
    if not lock_path:
        sys.exit("GPU_LOCK_PATH is not set")
    fsqueue.run_consumer(queue_dir, lock_path, Handler(queue_dir))


if __name__ == "__main__":
    main()
