.DEFAULT_GOAL := help
.PHONY: install build start help

help:
	@echo "Available commands:"
	@echo "  install   Install dependencies"
	@echo "  build     Run the build script, if configured"
	@echo "  start     Start the NATS spawn worker in the foreground"
	@echo "  help      Show this help message"
	@echo "Uses harness and agent-spawn env-dir/default plus ENV_USER (or USER)."
	@echo "HARNESS_NATS_URL overrides the allocated NATS HOST/PORT without changing this service's environment."
	@echo "HARNESS_SPAWN_TIMEOUT_MS sets the request timeout (default 30000, range 1000-300000)."

install:
	npm install

build:
	npm run build --if-present

start:
	../harness/scripts/run-with-env-dir ../harness/env-dir ../harness/scripts/run-with-env-dir ./env-dir sh ./start
