.DEFAULT_GOAL := help
.PHONY: help install build start

CL_DIR = ../../component-library

help:
	@echo "install   Install dependencies and build the component-library"
	@echo "build     Build production assets in dist/"
	@echo "start     Start Vite in the foreground"
	@echo "help      Show this help message"

install:
	$(MAKE) -C $(CL_DIR) install
	$(MAKE) -C $(CL_DIR) build
	npm install

build:
	$(MAKE) -C $(CL_DIR) build
	npm run build

start:
	envdir "./env-dir/$${ENV_USER:-$$USER}" npm start
