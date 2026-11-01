.PHONY: install install.js install.python install.model build start consumer help

HAS_CUDA ?= $(shell nvidia-smi -L >/dev/null 2>&1 && echo 1 || echo 0)
SKIP_NO_CUDA = @echo "categorizer: CUDA not available, skipping $@"

help:
	@echo "Available commands:"
	@echo "  install         Install node deps and the python venv"
	@echo "  install.js      Install node deps only"
	@echo "  install.python  Create cli/.venv and install cli/requirements.txt"
	@echo "  install.model   Prefetch LLM_MODEL weights (otherwise fetched on the first job)"
	@echo "  build           Run the build script, if configured"
	@echo "  start           Start the HTTP service in the foreground"
	@echo "  consumer        Drain the filesystem queue in the foreground"
	@echo "  help            Show this help message"
	@echo ""
	@echo "install.python, install.model, start, and consumer are no-ops without CUDA."
	@echo "Override detection with HAS_CUDA=0 or HAS_CUDA=1 (detected: $(HAS_CUDA))."

install:
	npm install
	${MAKE} install.python

install.js:
	npm install

PY_MIN_CHECK = -c 'import sys; sys.exit(sys.version_info < (3, 10))'
PYTHON ?= $(shell for p in python3.12 python3.13 python3.11 python3.10 python3; do command -v $$p >/dev/null 2>&1 && $$p $(PY_MIN_CHECK) 2>/dev/null && { echo $$p; break; }; done)

ifeq ($(HAS_CUDA),1)
install.python:
	@test -n "$(PYTHON)" || { echo "Python >= 3.10 is required (e.g. install python3.12, or pass PYTHON=/path/to/python)"; exit 1; }
	@cli/.venv/bin/python3 $(PY_MIN_CHECK) 2>/dev/null || rm -rf cli/.venv
	$(PYTHON) -m venv cli/.venv
	cli/.venv/bin/pip install --upgrade pip
	cli/.venv/bin/pip install -r cli/requirements.txt

install.model:
	./scripts/run-with-env-dir ./env-dir cli/.venv/bin/python3 cli/consumer.py --download

start:
	./scripts/run-with-env-dir ./env-dir npm start

consumer:
	./scripts/run-with-env-dir ./env-dir cli/.venv/bin/python3 -u cli/consumer.py
else
install.python install.model start consumer:
	$(SKIP_NO_CUDA)
endif

build:
	npm run build --if-present
