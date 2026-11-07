.PHONY: help install start cli models models.refresh tool-stats index.rebuild

help: ## Show this help
	@grep -E '^[a-zA-Z_.-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  %-16s %s\n", $$1, $$2}'

install: ## Install dependencies
	npm install

start: ## Start the Express API server and its maintenance worker
	./scripts/run-with-env-dir ./env-dir npm start

cli: ## Run the harness CLI (pass args via ARGS="...")
	./scripts/run-with-env-dir ./env-dir node bin/harness $(ARGS)

models: ## List available cursor models
	./scripts/run-with-env-dir ./env-dir node bin/harness models

models.refresh: ## Query providers and rewrite src/agents/models.json
	./scripts/run-with-env-dir ./env-dir node scripts/refresh-models.js

tool-stats: ## Tool-call analytics (ARGS="...")
	./scripts/run-with-env-dir ./env-dir node bin/harness tool-stats $(ARGS)

index.rebuild: ## Rebuild the SQLite session index from session.json files
	./scripts/run-with-env-dir ./env-dir node bin/harness reindex

.PHONY: typecheck sdk.build

typecheck: ## Check the TypeScript SDK, registry, and plugins
	npm run typecheck

sdk.build: ## Emit SDK, registry, and plugin TypeScript declarations
	npm run build:sdk
