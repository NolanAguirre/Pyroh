.DEFAULT_GOAL := help

ENV_DIR ?= ./env-dir
RUN_WITH_ENV = ./scripts/run-with-env-dir "$(ENV_DIR)"
SQITCH = $(RUN_WITH_ENV) ./scripts/render-sqitch-config sqitch

help:
	@echo 'Database: analytics (PostgreSQL, configured through env-dir)'
	@echo '  init    Create the database on the existing shared server (fails if present)'
	@echo '  render  Render sqitch.config from sqitch.config.template using env-dir'
	@echo '  deploy  Deploy pending Sqitch changes to local'
	@echo '  status  Show Sqitch deployment status'
	@echo '  verify  Run empty Sqitch verification scripts (no schema assertions)'
	@echo '  revert  Refuse reversion; this database is forward-only'
	@echo '  help    Show this help'
	@echo 'Requires Sqitch with PostgreSQL support, PostgreSQL client tools, and envsubst.'
	@echo 'Loads ENV_DIR/default then ENV_DIR/$$ENV_USER (defaults to $$USER); ENV_DIR=./env-dir.'
	@echo 'Set PGHOST, PGPORT, PGUSER, PGDATABASE, and optional PGPASSWORD in env-dir.'
	@echo 'Configure credentials outside this repository, e.g. with .pgpass.'
	@echo 'Next change: v1.001.0 with [v1.000.0] in sqitch.plan; depend on the predecessor thereafter.'
	@echo 'Use transactional, idempotent deploy SQL and empty revert/verify files for every version.'

init:
	$(RUN_WITH_ENV) sh -c 'exec createdb --maintenance-db=postgres "$$PGDATABASE"'
.PHONY: help init render deploy status verify revert

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
