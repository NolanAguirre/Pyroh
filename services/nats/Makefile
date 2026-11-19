.DEFAULT_GOAL := help
.PHONY: help start

help:
	@echo 'start   Start NATS with JetStream in the foreground on its allocated HOST and PORT'
	@echo '        Requires nats-server and s6-envdir; data persists in ~/.<repo>/jetstream/'
	@echo '        Load env-dir/default, then env-dir/ENV_USER (or USER)'
	@echo 'help    Show commands'

start:
	s6-envdir ./env-dir/default s6-envdir -I "./env-dir/$${ENV_USER:-$${USER:-default}}" sh ./start
