.DEFAULT_GOAL := help
.PHONY: help install build dev start

ENV_DIR ?= ./env-dir
RUN_WITH_ENV = ./scripts/run-with-env-dir "$(ENV_DIR)"

help:
	@echo 'install  Install locked API dependencies'
	@echo 'build    Run the build script, if configured'
	@echo 'dev      Start the API on loopback (PORT defaults to 6011)'
	@echo 'start    Start the API on loopback (PORT defaults to 6011)'
	@echo 'Loads ENV_DIR/default then ENV_DIR/$$ENV_USER (defaults to $$USER).'
	@echo 'DATABASE_URL is shared with db/kanban; deploy that database before starting.'

install:
	npm ci

build:
	npm run build --if-present

dev:
	$(RUN_WITH_ENV) npm run dev

start:
	$(RUN_WITH_ENV) npm start
