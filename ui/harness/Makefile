.PHONY: help setup install dev build lint preview

help: ## Show this help
	@grep -E '^[a-zA-Z_.-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  %-16s %s\n", $$1, $$2}'

setup: ## Clone component-library beside the project if missing
	@if [ ! -d "../../../component-library" ]; then \
		git clone git@github.com:NolanAguirre/component-library.git "../../../component-library"; \
	fi

install: ## Install dependencies
	npm install

dev: ## Start the Vite dev server
	./scripts/run-with-env-dir ./env-dir npm run dev

build: ## Build the production bundle
	npm run build

lint: ## Lint the source
	npm run lint

preview: ## Preview the production build
	./scripts/run-with-env-dir ./env-dir npm run preview
