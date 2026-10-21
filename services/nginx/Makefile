.PHONY: help start stop reload status test

# Prefix nginx uses for relative paths (logs, tmp, pid) in nginx.conf.
PREFIX := $(CURDIR)

help: ## Show this help
	@grep -E '^[a-zA-Z_.-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  %-16s %s\n", $$1, $$2}'

test: ## Validate the nginx config
	mkdir -p logs tmp
	nginx -p $(PREFIX) -c nginx.conf -t

start: ## Start nginx in front of the harness stack
	mkdir -p logs tmp
	if [ -f nginx.pid ] && kill -0 `cat nginx.pid` 2>/dev/null; then \
		echo "nginx already running (pid `cat nginx.pid`)"; \
	else \
		nginx -p $(PREFIX) -c nginx.conf; \
	fi

stop: ## Stop the running nginx
	nginx -p $(PREFIX) -c nginx.conf -s quit

reload: ## Reload the nginx config
	nginx -p $(PREFIX) -c nginx.conf -s reload

status: ## Show whether nginx is running
	@if [ -f nginx.pid ] && kill -0 `cat nginx.pid` 2>/dev/null; then \
		echo "nginx running (pid `cat nginx.pid`)"; \
	else \
		echo "nginx not running"; \
	fi
