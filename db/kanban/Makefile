.DEFAULT_GOAL := help
.PHONY: help init render deploy status verify revert

ENV_DIR ?= ./env-dir
RUN_WITH_ENV = ./scripts/run-with-env-dir "$(ENV_DIR)"
SQITCH = $(RUN_WITH_ENV) ./scripts/render-sqitch-config sqitch

help:
	@echo 'Database: kanban (PostgreSQL 14, schema kanban, configured through env-dir)'
	@echo '  init    Create the database on the existing shared server (fails if present)'
	@echo '  render  Render sqitch.config from sqitch.config.template using env-dir'
	@echo '  deploy  Deploy pending Sqitch changes to local'
	@echo '  status  Show Sqitch deployment status'
	@echo '  verify  Run empty Sqitch verification scripts (no schema assertions)'
	@echo '  revert  Refuse reversion; append a forward migration instead'
	@echo '  help    Show this help'
	@echo 'Requires Sqitch with PostgreSQL support, PostgreSQL client tools, and envsubst.'
	@echo 'Loads ENV_DIR/default then ENV_DIR/$$ENV_USER (defaults to $$USER); ENV_DIR=./env-dir.'
	@echo 'Set PGHOST, PGPORT, PGUSER, PGDATABASE, and optional PGPASSWORD in env-dir.'
	@echo 'Configure credentials outside this repository, e.g. with .pgpass.'
	@echo 'Historical deploy scripts are unchanged; all revert and verify files are empty.'
	@echo 'The deployment role must be able to install the citext extension in public.'

init:
	$(RUN_WITH_ENV) sh -c 'exec createdb --maintenance-db=postgres "$$PGDATABASE"'

render:
	$(RUN_WITH_ENV) ./scripts/render-sqitch-config

deploy:
	$(SQITCH) deploy --target local

status:
	$(SQITCH) status --target local

verify:
	$(SQITCH) verify --target local

revert:
	@echo 'error: forward-only migrations; append a corrective version instead of reverting' >&2
	@exit 1
