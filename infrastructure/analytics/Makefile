.PHONY: help reload

help:
	@echo 'reload  Reload nginx with analytics UI and API routing'
	@echo 'UI      /analytics/ -> localhost:6013'
	@echo 'API     /analytics/api/ -> localhost:6006'

reload:
	$(MAKE) -C ../../services/nginx reload
