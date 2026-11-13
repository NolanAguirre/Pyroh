.DEFAULT_GOAL := help
.PHONY: help deploy status revert

ENV_DIR ?= ../../services/kanban/env-dir
RUN_WITH_ENV = ./scripts/run-with-env-dir "$(ENV_DIR)"
SQITCH = $(RUN_WITH_ENV) ./scripts/sqitch

help:
	@echo 'Database: kanban (PostgreSQL 14, schema kanban)'
	@echo 'deploy  Deploy pending Sqitch changes'
	@echo 'status  Show Sqitch deployment status'
	@echo 'revert  Refuse reversion; append a forward migration instead'
	@echo 'Requires Sqitch with PostgreSQL support, client tools, and an existing database.'
	@echo 'Shares DATABASE_URL from services/kanban/env-dir by default; override ENV_DIR if needed.'
	@echo 'Loads ENV_DIR/default then ENV_DIR/$$ENV_USER (defaults to $$USER).'
	@echo 'Historical deploy scripts are unchanged; all revert and verify files are empty.'
	@echo 'The deployment role must be able to install the citext extension in public.'

deploy:
	$(SQITCH) deploy

status:
	$(SQITCH) status

revert:
	@echo 'error: forward-only migrations; append a corrective version instead of reverting' >&2
	@exit 1
