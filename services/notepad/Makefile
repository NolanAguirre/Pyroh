.DEFAULT_GOAL := help
.PHONY: install build start help

help:
	@echo "Available commands:"
	@echo "  install   Install dependencies"
	@echo "  build     Run the build script, if configured"
	@echo "  start     Start the service in the foreground"
	@echo "  help      Show this help message"

install:
	npm install

build:
	npm run build --if-present

start:
	s6-envdir ./env-dir/default s6-envdir -I "./env-dir/$${ENV_USER:-$$USER}" npm start

