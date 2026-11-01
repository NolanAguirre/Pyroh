.PHONY: install build start import help

help:
	@echo "Available commands:"
	@echo "  install   Install dependencies"
	@echo "  build     Run the build script, if configured"
	@echo "  start     Start the service in the foreground"
	@echo "  import    Import dev ids from repos (REPOS=\"~/a ~/b\")"
	@echo "  help      Show this help message"

install:
	npm install

build:
	npm run build --if-present

start:
	envdir "./env-dir/$${ENV_USER:-$$USER}" npm start

import:
	@if [ -z "$(REPOS)" ]; then echo 'usage: make import REPOS="~/a ~/b"' >&2; exit 1; fi
	envdir "./env-dir/$${ENV_USER:-$$USER}" node scripts/import.js $(REPOS)
