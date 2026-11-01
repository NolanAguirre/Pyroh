.PHONY: services.terminal.install services.terminal.build services.terminal.start services.terminal.stop-host services.terminal.host services.terminal.help services.editor.install services.editor.build services.editor.start services.editor.help services.git.install services.git.build services.git.start services.git.help

.PHONY: help install install.js install.py start \
	services.harness.install services.harness.start services.harness.cli services.harness.models services.harness.models.refresh services.harness.tool-stats services.harness.index.rebuild \
	services.categorizer.install services.categorizer.install.js services.categorizer.install.python services.categorizer.install.model services.categorizer.start services.categorizer.consumer \
	services.analytics.install services.analytics.build services.analytics.start services.analytics.sync services.analytics.backfill \
	services.mcp-memory.install services.mcp-memory.build services.mcp-memory.start services.mcp-memory.help \
	services.memory.install services.memory.build services.memory.start services.memory.help \
	services.mcpdevid.install services.mcpdevid.build services.mcpdevid.start services.mcpdevid.import services.mcpdevid.help \
	ui.harness.install ui.harness.dev ui.harness.build ui.harness.lint ui.harness.preview \
	services.nginx.start services.nginx.stop services.nginx.reload services.nginx.status services.nginx.test services.nginx.render

help: ## Show this help
	@grep -E '^[a-zA-Z_.-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  %-32s %s\n", $$1, $$2}'

services.harness.install: ## Install harness service deps
	$(MAKE) -C services/harness install

services.harness.start: ## Start the harness API server
	$(MAKE) -C services/harness start

services.harness.cli: ## Run the harness CLI (ARGS="...")
	$(MAKE) -C services/harness cli ARGS="$(ARGS)"

services.harness.models: ## List cursor models
	$(MAKE) -C services/harness models

services.harness.models.refresh: ## Refresh provider model lists (src/agents/models.json)
	$(MAKE) -C services/harness models.refresh

services.harness.tool-stats: ## Harness tool-call analytics (ARGS="...")
	$(MAKE) -C services/harness tool-stats ARGS="$(ARGS)"

services.harness.index.rebuild: ## Rebuild the harness SQLite session index
	$(MAKE) -C services/harness index.rebuild

services.categorizer.install: ## Install categorizer node deps and python venv
	$(MAKE) -C services/categorizer install

services.categorizer.install.js: ## Install categorizer node deps only
	$(MAKE) -C services/categorizer install.js

services.categorizer.install.python: ## Create the categorizer venv and install its python deps
	$(MAKE) -C services/categorizer install.python

services.categorizer.install.model: ## Prefetch the categorizer model weights
	$(MAKE) -C services/categorizer install.model

services.categorizer.start: ## Start the categorizer HTTP service
	$(MAKE) -C services/categorizer start

services.categorizer.consumer: ## Run the categorizer GPU queue consumer
	$(MAKE) -C services/categorizer consumer

services.analytics.install: ## Install analytics service deps
	$(MAKE) -C services/analytics install

services.analytics.build: ## analytics: Run the configured build
	$(MAKE) -C services/analytics build

services.analytics.start: ## Start the analytics service in the foreground
	$(MAKE) -C services/analytics start

services.analytics.sync: ## Rescan sessions and compute stale metrics (SESSION=<id> optional)
	$(MAKE) -C services/analytics sync SESSION="$(SESSION)"

services.analytics.backfill: ## Recompute stale results for a metric (METRIC=<name>, FORCE=1 for all)
	$(MAKE) -C services/analytics backfill METRIC="$(METRIC)" FORCE="$(FORCE)"

services.mcp-memory.install: ## mcp-memory: Install dependencies
	$(MAKE) -C services/mcp-memory install

services.mcp-memory.build: ## mcp-memory: Run the configured build
	$(MAKE) -C services/mcp-memory build

services.mcp-memory.start: ## mcp-memory: Start the memory MCP server
	$(MAKE) -C services/mcp-memory start

services.mcp-memory.help: ## mcp-memory: Show service help
	$(MAKE) -C services/mcp-memory help

services.memory.install: ## memory: Install dependencies
	$(MAKE) -C services/memory install

services.memory.build: ## memory: Run the configured build
	$(MAKE) -C services/memory build

services.memory.start: ## memory: Start the foreground memory CRUD API
	$(MAKE) -C services/memory start

services.memory.help: ## memory: Show service help
	$(MAKE) -C services/memory help

services.mcpdevid.install: ## mcpdevid: Install dependencies
	$(MAKE) -C services/mcpdevid install

services.mcpdevid.build: ## mcpdevid: Run the configured build
	$(MAKE) -C services/mcpdevid build

services.mcpdevid.start: ## mcpdevid: Start the dev id MCP server
	$(MAKE) -C services/mcpdevid start

services.mcpdevid.import: ## mcpdevid: Import dev ids from repos (REPOS="~/a ~/b")
	$(MAKE) -C services/mcpdevid import REPOS="$(REPOS)"

services.mcpdevid.help: ## mcpdevid: Show service help
	$(MAKE) -C services/mcpdevid help

ui.harness.install: ## Install harness UI deps
	$(MAKE) -C ui/harness install

ui.harness.dev: ## Start the harness UI dev server
	$(MAKE) -C ui/harness dev

ui.harness.build: ## Build the harness UI
	$(MAKE) -C ui/harness build

ui.harness.lint: ## Lint the harness UI
	$(MAKE) -C ui/harness lint

ui.harness.preview: ## Preview the harness UI build
	$(MAKE) -C ui/harness preview

services.nginx.start: ## Start nginx in front of the harness stack
	$(MAKE) -C services/nginx start

services.nginx.stop: ## Stop the harness nginx
	$(MAKE) -C services/nginx stop

services.nginx.reload: ## Reload the nginx config
	$(MAKE) -C services/nginx reload

services.nginx.status: ## Show whether nginx is running
	$(MAKE) -C services/nginx status

services.nginx.test: ## Validate the nginx config
	$(MAKE) -C services/nginx test

services.nginx.render: ## Render machines.json into nginx machine routing
	$(MAKE) -C services/nginx render

services.terminal.install: ## terminal: Install dependencies
	$(MAKE) -C services/terminal install

services.terminal.build: ## terminal: Run the configured build
	$(MAKE) -C services/terminal build

services.terminal.start: ## terminal: Start the foreground API server
	$(MAKE) -C services/terminal start

services.terminal.stop-host: ## terminal: Stop the pty host (kills all shells)
	$(MAKE) -C services/terminal stop-host

services.terminal.host: ## terminal: Run the pty host in the foreground for debugging
	$(MAKE) -C services/terminal host

services.terminal.help: ## terminal: Show service help
	$(MAKE) -C services/terminal help

services.editor.install: ## editor: Install dependencies
	$(MAKE) -C services/editor install

services.editor.build: ## editor: Run the configured build
	$(MAKE) -C services/editor build

services.editor.start: ## editor: Start the foreground API server
	$(MAKE) -C services/editor start

services.editor.help: ## editor: Show service help
	$(MAKE) -C services/editor help

services.git.install: ## git: Install dependencies
	$(MAKE) -C services/git install

services.git.build: ## git: Run the configured build
	$(MAKE) -C services/git build

services.git.start: ## git: Start the foreground API server
	$(MAKE) -C services/git start

services.git.help: ## git: Show service help
	$(MAKE) -C services/git help

install: ## Install all services and UIs, including python venvs
	$(MAKE) services.harness.install
	$(MAKE) services.terminal.install
	$(MAKE) services.editor.install
	$(MAKE) services.git.install
	$(MAKE) services.categorizer.install
	$(MAKE) services.analytics.install
	$(MAKE) services.mcp-memory.install
	$(MAKE) services.memory.install
	$(MAKE) services.mcpdevid.install
	$(MAKE) ui.harness.install

install.js: ## Install only JS packages across all services and UIs
	$(MAKE) services.harness.install
	$(MAKE) services.terminal.install
	$(MAKE) services.editor.install
	$(MAKE) services.git.install
	$(MAKE) services.categorizer.install.js
	$(MAKE) services.analytics.install
	$(MAKE) services.mcp-memory.install
	$(MAKE) services.memory.install
	$(MAKE) services.mcpdevid.install
	$(MAKE) ui.harness.install

install.py: ## Install python venvs for the GPU services
	$(MAKE) services.categorizer.install.python

start: SHELL := /bin/bash
start: ## Start the harness stack and stop its child process groups on exit
	@$(MAKE) db.harness.deploy
	@$(MAKE) db.mcpdevid.deploy
	@pids=""; \
	cleanup() { trap '' INT TERM; for pid in $$pids; do kill -TERM -- -$$pid 2>/dev/null || true; done; wait || true; }; \
	trap cleanup EXIT; trap 'exit 130' INT; trap 'exit 143' TERM; \
	setsid $(MAKE) -C services/nginx start & pids="$$pids $$!"; \
	setsid $(MAKE) -C services/harness start & pids="$$pids $$!"; \
	setsid $(MAKE) -C services/terminal start & pids="$$pids $$!"; \
	setsid $(MAKE) -C services/editor start & pids="$$pids $$!"; \
	setsid $(MAKE) -C services/git start & pids="$$pids $$!"; \
	setsid $(MAKE) -C services/categorizer start & pids="$$pids $$!"; \
	setsid $(MAKE) -C services/categorizer consumer & pids="$$pids $$!"; \
	setsid $(MAKE) -C services/analytics start & pids="$$pids $$!"; \
	setsid $(MAKE) -C services/mcp-memory start & pids="$$pids $$!"; \
	setsid $(MAKE) -C services/memory start & pids="$$pids $$!"; \
	setsid $(MAKE) -C services/mcpdevid start & pids="$$pids $$!"; \
	setsid $(MAKE) -C ui/harness dev & pids="$$pids $$!"; \
	wait

# Sqitch database db/analytics
.PHONY: help db.analytics.help db.analytics.init db.analytics.deploy db.analytics.status db.analytics.verify db.analytics.revert

help: db.analytics.help

db.analytics.help:
	@echo 'db/analytics: db.analytics.init db.analytics.deploy db.analytics.status db.analytics.verify db.analytics.revert'
	@$(MAKE) --no-print-directory -C db/analytics help

db.analytics.init: ## Create the analytics database
	$(MAKE) -C db/analytics init

db.analytics.deploy: ## Deploy pending analytics Sqitch changes
	$(MAKE) -C db/analytics deploy

db.analytics.status: ## Show analytics Sqitch status
	$(MAKE) -C db/analytics status

db.analytics.verify: ## Run analytics Sqitch verify scripts
	$(MAKE) -C db/analytics verify

db.analytics.revert: ## Refuse revert (forward-only)
	$(MAKE) -C db/analytics revert

# Sqitch database db/harness
.PHONY: help db.harness.help db.harness.init db.harness.deploy db.harness.status db.harness.verify db.harness.revert

help: db.harness.help

db.harness.help:
	@echo 'db/harness: db.harness.init db.harness.deploy db.harness.status db.harness.verify db.harness.revert'
	@$(MAKE) --no-print-directory -C db/harness help

db.harness.init:
	$(MAKE) -C db/harness init

db.harness.deploy:
	$(MAKE) -C db/harness deploy

db.harness.status:
	$(MAKE) -C db/harness status

db.harness.verify:
	$(MAKE) -C db/harness verify

db.harness.revert:
	$(MAKE) -C db/harness revert

# Sqitch database db/mcpdevid
.PHONY: help db.mcpdevid.help db.mcpdevid.init db.mcpdevid.deploy db.mcpdevid.status db.mcpdevid.verify db.mcpdevid.revert

help: db.mcpdevid.help

db.mcpdevid.help:
	@echo 'db/mcpdevid: db.mcpdevid.init db.mcpdevid.deploy db.mcpdevid.status db.mcpdevid.verify db.mcpdevid.revert'
	@$(MAKE) --no-print-directory -C db/mcpdevid help

db.mcpdevid.init:
	$(MAKE) -C db/mcpdevid init

db.mcpdevid.deploy:
	$(MAKE) -C db/mcpdevid deploy

db.mcpdevid.status:
	$(MAKE) -C db/mcpdevid status

db.mcpdevid.verify:
	$(MAKE) -C db/mcpdevid verify

db.mcpdevid.revert:
	$(MAKE) -C db/mcpdevid revert
