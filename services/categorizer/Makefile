.PHONY: install install.js install.python install.model build start consumer help

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

install:
	npm install
	${MAKE} install.python

install.js:
	npm install

install.python:
	python3 -m venv cli/.venv
	cli/.venv/bin/pip install --upgrade pip
	cli/.venv/bin/pip install -r cli/requirements.txt

install.model:
	./scripts/run-with-env-dir ./env-dir cli/.venv/bin/python3 cli/consumer.py --download

build:
	npm run build --if-present

start:
	./scripts/run-with-env-dir ./env-dir npm start

consumer:
	./scripts/run-with-env-dir ./env-dir cli/.venv/bin/python3 -u cli/consumer.py
