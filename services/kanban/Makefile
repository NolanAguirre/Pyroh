.DEFAULT_GOAL := help
.PHONY: help install prepare build dev start

ENV_DIR ?= ./env-dir
RUN_WITH_ENV = ./scripts/run-with-env-dir "$(ENV_DIR)"

help:
	@echo 'install  Install locked API dependencies'
	@echo 'prepare  Install locked API dependencies when missing or outdated'
	@echo 'build    Run the build script, if configured'
	@echo 'dev      Start the API on loopback (PORT defaults to 6011)'
	@echo 'start    Start the API on loopback (PORT defaults to 6011)'
	@echo 'Loads ENV_DIR/default then ENV_DIR/$$ENV_USER (defaults to $$USER).'
	@echo 'DATABASE_URL is shared with db/kanban; deploy that database before starting.'
	@echo 'dev and start prepare dependencies before launching the API.'

install:
	npm ci

prepare: node_modules/.package-lock.json

node_modules/.package-lock.json: package.json package-lock.json
	$(MAKE) install

build:
	npm run build --if-present

dev: prepare
	$(RUN_WITH_ENV) npm run dev

start: prepare
	$(RUN_WITH_ENV) npm start
