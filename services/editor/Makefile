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
	./scripts/run-with-env-dir ./env-dir node src/server/index.js
