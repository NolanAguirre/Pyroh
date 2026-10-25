.PHONY: help start stop reload status test render

# Prefix nginx uses for relative paths (logs, tmp, pid) in nginx.conf.
PREFIX := $(CURDIR)

help: ## Show this help
	@grep -E '^[a-zA-Z_.-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  %-16s %s\n", $$1, $$2}'

render: ## Render machines.json into machines.conf and machines.public.json
	node render-machines.js

test: render ## Validate the nginx config
	mkdir -p logs tmp
	nginx -p $(PREFIX) -c nginx.conf -t

start: render ## Start nginx in front of the harness stack
	mkdir -p logs tmp
	if [ -f nginx.pid ] && kill -0 `cat nginx.pid` 2>/dev/null; then \
		echo "nginx already running (pid `cat nginx.pid`)"; \
	else \
		nginx -p $(PREFIX) -c nginx.conf; \
	fi

stop: ## Stop the running nginx
	nginx -p $(PREFIX) -c nginx.conf -s quit

reload: render ## Reload the nginx config
	nginx -p $(PREFIX) -c nginx.conf -s reload

status: ## Show whether nginx is running
	@if [ -f nginx.pid ] && kill -0 `cat nginx.pid` 2>/dev/null; then \
		echo "nginx running (pid `cat nginx.pid`)"; \
	else \
		echo "nginx not running"; \
	fi
