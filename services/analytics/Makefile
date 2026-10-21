.PHONY: help install build start sync backfill

URL ?= http://localhost:6006

help:
	@echo "Available commands:"
	@echo "  install   Install dependencies"
	@echo "  build     Run the build script, if configured"
	@echo "  start     Start the service in the foreground"
	@echo "  sync      Rescan sessions and compute stale metrics (SESSION=<id> for one)"
	@echo "  backfill  Recompute stale results for a metric (METRIC=<name>, FORCE=1 for all)"
	@echo "  help      Show this help message"

install:
	npm install

build:
	npm run build --if-present

start:
	./scripts/run-with-env-dir ./env-dir npm start

sync:
	curl -fsS -X POST -H 'Content-Type: application/json' \
		-d '{"sessionId":$(if $(SESSION),"$(SESSION)",null)}' $(URL)/sync
	@echo

backfill:
	@test -n "$(METRIC)" || { echo "usage: make backfill METRIC=<name> [FORCE=1]" >&2; exit 2; }
	curl -fsS -X POST -H 'Content-Type: application/json' \
		-d '{"force":$(if $(FORCE),true,false)}' $(URL)/metrics/$(METRIC)/backfill
	@echo
