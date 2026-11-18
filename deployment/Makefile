.DEFAULT_GOAL := help
SERVICES ?= spellcheck spellcheck-consumer
.PHONY: help prepare

help:
	@echo 'prepare OUTPUT=/absolute/path [SERVICES="spellcheck spellcheck-consumer"]'
	@echo 'Package services into the supplied release directory'

prepare:
	@test -n "$(OUTPUT)" || { echo 'error: OUTPUT is required' >&2; exit 2; }
	sh ./prepare "$(OUTPUT)" $(SERVICES)
