.PHONY: install install.js install.python install.model build start consumer package deploy help

REMOTE_TARGET ?= workstation
RELEASE_DIR := $(abspath ../../tmp/spellcheck-release)

help:
	@echo "Available commands:"
	@echo "  install         Install node and python dependencies"
	@echo "  install.js      Install node dependencies only"
	@echo "  install.python  Create cli/.venv and install cli/requirements.txt"
	@echo "  install.model   Prefetch LLM_MODEL weights (otherwise fetched on the first job)"
	@echo "  build           Run the build script, if configured"
	@echo "  start           Start the service in the background"
	@echo "  consumer        Drain the filesystem queue in the foreground"
	@echo "  package         Package API and consumer releases under tmp/spellcheck-release"
	@echo "  deploy          Package and deploy both services (REMOTE_TARGET=workstation)"
	@echo "  help            Show this help message"

install:
	npm install
	$(MAKE) install.python

install.js:
	npm install

install.python:
	python3 -m venv cli/.venv
	cli/.venv/bin/pip install --upgrade pip
	cli/.venv/bin/pip install -r cli/requirements.txt

install.model:
	envdir "./env-dir/$${ENV_USER:-$$USER}" cli/.venv/bin/python3 cli/consumer.py --download

build:
	npm run build --if-present

start:
	nohup envdir "./env-dir/$${ENV_USER:-$$USER}" npm start >start.log 2>&1 </dev/null & echo "started in background, pid $$! (logs: start.log)"

consumer:
	envdir "./env-dir/$${ENV_USER:-$$USER}" cli/.venv/bin/python3 -u cli/consumer.py

package:
	bash scripts/package

deploy: package
	remote deploy harness spellcheck-consumer "$(RELEASE_DIR)/spellcheck-consumer" --to "$(REMOTE_TARGET)"
	remote deploy harness spellcheck "$(RELEASE_DIR)/spellcheck" --to "$(REMOTE_TARGET)"
