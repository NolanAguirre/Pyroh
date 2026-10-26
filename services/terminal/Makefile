.PHONY: install build start stop-host host help

HAS_CUDA ?= $(shell nvidia-smi -L >/dev/null 2>&1 && echo 1 || echo 0)

help:
	@echo "Available commands:"
	@echo "  install   Install dependencies"
	@echo "  build     Run the build script, if configured"
	@echo "  start     Start the service in the foreground"
	@echo "  stop-host Stop the pty host (kills all shells)"
	@echo "  host      Run the pty host in the foreground for debugging"
	@echo "  help      Show this help message"

install:
	npm install

build:
	npm run build --if-present

start:
	HARNESS_CATEGORIZER_ENABLED=$(HAS_CUDA) ./scripts/run-with-env-dir ./env-dir node src/server/index.js

stop-host:
	./scripts/run-with-env-dir ./env-dir node src/ptyHost/stop.js

host:
	./scripts/run-with-env-dir ./env-dir node src/ptyHost/index.js --foreground
