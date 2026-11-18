#!/usr/bin/env python3
"""Spellcheck picker consumer.

Each job is one prompt's unknown words, each with five words of context on
either side and up to five nspell suggestions. For every word the model
answers with a number: 0 keeps the word, 1..n picks a suggestion. The picks
are written back into the descriptor as result.picks; the Node service reads
them from done/ and applies the fixes.

The model stays loaded, holding the GPU flock, until MODEL_IDLE_SECONDS pass
with no new job. 0 unloads after every batch like the other GPU services.

Debug one-shot (also takes the GPU lock):

    consumer.py --pick WORD "before words" "after words" SUGGESTION...

Prefetch the weights (make install.model):

    consumer.py --download
"""

import argparse
import gc
import json
import math
import os
import re
import signal
import sys
import tempfile
import time
from datetime import datetime

import fsqueue

DEFAULT_MODEL = os.environ.get("LLM_MODEL", "Qwen/Qwen3.5-9B")
DEFAULT_QUANT = os.environ.get("LLM_QUANT", "8bit")
DEFAULT_MAX_MEMORY = os.environ.get("LLM_MAX_MEMORY", "14GiB")
IDLE_SECONDS = float(os.environ.get("MODEL_IDLE_SECONDS", "3600"))
GENERATION_MAX_NEW_TOKENS = int(os.environ.get("GENERATION_MAX_NEW_TOKENS", "16384"))
GENERATION_CONTEXT_TOKENS = int(os.environ.get("GENERATION_CONTEXT_TOKENS", "32768"))
POLL_SECONDS = 0.05
MAX_NEW_TOKENS = 3

SYSTEM_PROMPT = (
    "You fix typos in messages a developer types to a coding assistant. You "
    "are shown one word that a dictionary did not recognize, the words around "
    "it, and numbered options. Pick 0 when the word is intentional, such as a "
    "name, a technical term or slang, or when no option fits. Otherwise pick "
    "the option the developer meant to type. Reply with the number only."
)


def build_prompt(item):
    lines = [
        "Context: " + " ".join(part for part in (item.get("before"), "[" + item["word"] + "]", item.get("after")) if part),
        "Word: " + item["word"],
        "Options:",
        "0 = No change",
    ]
    for index, suggestion in enumerate(item["suggestions"], start=1):
        lines.append(str(index) + " = " + suggestion)
    return "\n".join(lines)


def parse_pick(raw, count):
    # Only an exact number counts; anything else keeps the word.
    text = raw.strip()
    if not re.fullmatch(r"\d+", text):
        return 0
    pick = int(text)
    return pick if 0 <= pick <= count else 0


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
        # AutoModelForCausalLM loads the text model only; the vision tower is skipped.
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

    def pick(self, item):
        import torch

        messages = [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": build_prompt(item)},
        ]
        inputs = self.tokenizer.apply_chat_template(
            messages,
            add_generation_prompt=True,
            enable_thinking=False,
            return_dict=True,
            return_tensors="pt",
        ).to(self.model.device)
        pad_token_id = self.tokenizer.pad_token_id
        if pad_token_id is None:
            pad_token_id = self.tokenizer.eos_token_id

        with torch.inference_mode():
            output = self.model.generate(
                **inputs,
                max_new_tokens=MAX_NEW_TOKENS,
                do_sample=False,
                temperature=None,
                top_p=None,
                top_k=None,
                pad_token_id=pad_token_id,
            )
        prompt_length = inputs["input_ids"].shape[1]
        raw = self.tokenizer.decode(output[0][prompt_length:], skip_special_tokens=True)
        return parse_pick(raw, len(item["suggestions"]))

    def _write_result(self, descriptor, result):
        # Rewrite the processing descriptor atomically so the Node poller never
        # sees a partial file; the queue loop then moves it to done/.
        record = {key: value for key, value in descriptor.items() if not key.startswith("_")}
        record["result"] = result
        tmp_dir = os.path.join(self.queue_dir, "tmp")
        os.makedirs(tmp_dir, exist_ok=True)
        fd, tmp_path = tempfile.mkstemp(dir=tmp_dir, prefix=descriptor["_name"] + ".", suffix=".result")
        try:
            # mkstemp ignores umask (0600); the API reads results through the shared queue group.
            os.fchmod(fd, 0o660)
            with os.fdopen(fd, "w") as handle:
                json.dump(record, handle)
            os.replace(tmp_path, descriptor["_path"])
        except BaseException:
            fsqueue.remove_temp(tmp_path)
            raise

    def generate(self, descriptor):
        import torch

        messages = descriptor.get("messages")
        if not isinstance(messages, list) or not 1 <= len(messages) <= 128:
            raise ValueError("messages must contain 1 to 128 messages")
        for index, message in enumerate(messages):
            if not isinstance(message, dict) or message.get("role") not in ("system", "user", "assistant"):
                raise ValueError("each message must have a system, user or assistant role")
            if not isinstance(message.get("content"), str) or not message["content"].strip():
                raise ValueError("each message must have nonempty string content")
            if message["role"] == "system" and index != 0:
                raise ValueError("system messages must be first")
        if messages[-1]["role"] != "user":
            raise ValueError("the last message must have the user role")
        if GENERATION_MAX_NEW_TOKENS < 1 or GENERATION_CONTEXT_TOKENS < 1:
            raise ValueError("Generation token limits must be positive")
        expires_at = datetime.fromisoformat(descriptor["expires_at"])
        if expires_at.tzinfo is None:
            raise ValueError("Generation expiry must include a timezone")
        deadline = expires_at.timestamp()
        if not math.isfinite(deadline) or time.time() >= deadline:
            raise TimeoutError("Generation exceeded its overall timeout")

        max_new_tokens = descriptor.get("max_new_tokens")
        if max_new_tokens is None:
            # Reordering/copying prompts need room for the entire input, using
            # this model's tokenizer without loading a model in the caller.
            content_tokens = sum(len(self.tokenizer.encode(message["content"], add_special_tokens=False))
                                 for message in messages if message["role"] == "user")
            max_new_tokens = max(2048, math.ceil(content_tokens * 1.25) + 256)
        if type(max_new_tokens) is not int or not 1 <= max_new_tokens <= GENERATION_MAX_NEW_TOKENS:
            raise ValueError("Requested output exceeds the generation token limit (" + str(GENERATION_MAX_NEW_TOKENS) + ")")

        inputs = self.tokenizer.apply_chat_template(
            messages,
            add_generation_prompt=True,
            enable_thinking=False,
            return_dict=True,
            return_tensors="pt",
        )
        prompt_length = inputs["input_ids"].shape[1]
        limits = [GENERATION_CONTEXT_TOKENS]
        for config in (self.model.config, getattr(self.model.config, "text_config", None)):
            limit = getattr(config, "max_position_embeddings", None)
            if isinstance(limit, int) and limit > 0:
                limits.append(limit)
        tokenizer_limit = getattr(self.tokenizer, "model_max_length", None)
        if isinstance(tokenizer_limit, int) and 0 < tokenizer_limit < 1_000_000_000:
            limits.append(tokenizer_limit)
        context_limit = min(limits)
        if prompt_length + max_new_tokens > context_limit:
            raise ValueError("Prompt and output budget exceed the model context limit (" + str(context_limit) + " tokens). Use a smaller input.")

        remaining = deadline - time.time()
        if remaining <= 0:
            raise TimeoutError("Generation exceeded its overall timeout")
        inputs = inputs.to(self.model.device)
        pad_token_id = self.tokenizer.pad_token_id
        if pad_token_id is None:
            pad_token_id = self.tokenizer.eos_token_id
        with torch.inference_mode():
            output = self.model.generate(
                **inputs,
                max_new_tokens=max_new_tokens,
                max_time=remaining,
                do_sample=False,
                temperature=None,
                top_p=None,
                top_k=None,
                pad_token_id=pad_token_id,
            )
        if time.time() >= deadline:
            raise TimeoutError("Generation exceeded its overall timeout")
        tokens = output[0][prompt_length:]
        eos = getattr(self.model.generation_config, "eos_token_id", None)
        if eos is None:
            eos = self.tokenizer.eos_token_id
        eos_ids = eos if isinstance(eos, (list, tuple)) else [eos]
        if len(tokens) >= max_new_tokens and int(tokens[-1]) not in eos_ids:
            raise RuntimeError("Generation exhausted its output token budget")
        text = self.tokenizer.decode(tokens, skip_special_tokens=True).strip()
        if not text:
            raise RuntimeError("Generation returned empty text")
        return {
            "text": text,
            "model": self.model_id,
            "input_tokens": prompt_length,
            "output_tokens": len(tokens),
            "max_new_tokens": max_new_tokens,
        }

    def process(self, descriptor):
        if descriptor.get("type") == "generate":
            try:
                result = self.generate(descriptor)
            except Exception as error:
                self._write_result(descriptor, {"error": str(error)})
                raise
            self._write_result(descriptor, result)
            sys.stderr.write(str(descriptor.get("_name")) + ": generated\n")
            sys.stderr.flush()
            return
        words = descriptor.get("words")
        if not isinstance(words, list):
            raise ValueError("descriptor has no words list")
        picks = [self.pick(item) for item in words]
        self._write_result(descriptor, {"picks": picks})
        changed = [item["word"] + " -> " + item["suggestions"][p - 1] for item, p in zip(words, picks) if p]
        sys.stderr.write(str(descriptor.get("_name")) + ": " + (", ".join(changed) or "no change") + "\n")
        sys.stderr.flush()


def run_consumer(queue_dir, lock_path, handler, idle_seconds):
    # fsqueue.run_consumer, except the model stays loaded until the queue has
    # been empty for idle_seconds, so back-to-back prompts skip the load.
    fsqueue.ensure_dirs(queue_dir)
    fsqueue.sweep_stale(queue_dir)

    state = {"running": True}

    def handle_signal(signum, frame):
        state["running"] = False

    signal.signal(signal.SIGTERM, handle_signal)
    signal.signal(signal.SIGINT, handle_signal)

    sys.stderr.write("consumer ready, watching " + queue_dir + "\n")
    sys.stderr.flush()

    while state["running"]:
        descriptor = fsqueue.claim(queue_dir)
        if descriptor is None:
            time.sleep(POLL_SECONDS)
            continue
        lock_handle = fsqueue.acquire_lock(lock_path)
        try:
            try:
                handler.load()
            except Exception as error:
                sys.stderr.write("model load failed: " + str(error) + "\n")
                if descriptor.get("type") == "generate":
                    handler._write_result(descriptor, {"error": "Model load failed: " + str(error)})
                fsqueue._finish(queue_dir, descriptor, ok=False)
                handler.unload()
                continue
            try:
                idle_since = time.monotonic()
                while descriptor is not None or (state["running"] and time.monotonic() - idle_since < idle_seconds):
                    if descriptor is None:
                        time.sleep(POLL_SECONDS)
                        descriptor = fsqueue.claim(queue_dir)
                        continue
                    try:
                        handler.process(descriptor)
                        fsqueue._finish(queue_dir, descriptor, ok=True)
                    except Exception as error:
                        sys.stderr.write("job " + str(descriptor.get("_name")) + " failed: " + str(error) + "\n")
                        fsqueue._finish(queue_dir, descriptor, ok=False)
                    idle_since = time.monotonic()
                    descriptor = fsqueue.claim(queue_dir)
            finally:
                try:
                    handler.unload()
                except Exception as error:
                    sys.stderr.write("model unload failed: " + str(error) + "\n")
        finally:
            fsqueue.release_lock(lock_handle)


def run_once(word, before, after, suggestions):
    lock_path = os.environ.get("GPU_LOCK_PATH")
    if not lock_path:
        sys.exit("GPU_LOCK_PATH is not set")
    handler = Handler()
    item = {"word": word, "before": before, "after": after, "suggestions": suggestions[:5]}
    lock_handle = fsqueue.acquire_lock(lock_path)
    try:
        handler.load()
        try:
            pick = handler.pick(item)
            print(pick, "=", item["suggestions"][pick - 1] if pick else "No change")
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
    parser = argparse.ArgumentParser(description="Spellcheck picker consumer")
    parser.add_argument("--pick", nargs="+", metavar="ARG",
                        help="WORD BEFORE AFTER SUGGESTION...: pick for one word and print it")
    parser.add_argument("--download", action="store_true", help="Download LLM_MODEL weights and exit")
    args = parser.parse_args()

    if args.download:
        download()
        return

    if args.pick:
        if len(args.pick) < 4:
            parser.error("--pick needs WORD BEFORE AFTER and at least one SUGGESTION")
        word, before, after, *suggestions = args.pick
        run_once(word, before, after, suggestions)
        return

    queue_dir = os.environ.get("QUEUE_DIR")
    lock_path = os.environ.get("GPU_LOCK_PATH")
    if not queue_dir:
        sys.exit("QUEUE_DIR is not set")
    if not lock_path:
        sys.exit("GPU_LOCK_PATH is not set")
    run_consumer(queue_dir, lock_path, Handler(queue_dir), IDLE_SECONDS)


if __name__ == "__main__":
    main()
