RUN_ID ?= lokal
GITHUB_REPO ?= specrun-lab/levelboard-$(RUN_ID)
LIVE_DOMAIN ?=
LIVE_URL ?= https://$(RUN_ID).$(LIVE_DOMAIN)
API_URL ?= http://127.0.0.1:8081
URL ?= http://127.0.0.1:8080
LEVEL := $(shell cat .run/level 2>/dev/null || echo 10)
LEVELS := $(shell seq 1 $(LEVEL))
TESTFILES := $(foreach n,$(LEVELS),tests/level$(n).spec.ts)
REPORT_API := $(if $(filter 1,$(shell test $(LEVEL) -ge 5 && echo 1)),1,)
REPORT_LIVE := $(if $(filter 1,$(shell test $(LEVEL) -ge 9 && echo 1)),1,)

define BUILD_FRONTEND
	cd frontend && npm ci && npm run build
endef

define BUILD_BACKEND
	cd backend && go build -o bin/levelboard-backend .
endef

define START_NGINX
	mkdir -p .run/nginx-tmp
	nginx -p "$(CURDIR)/" -e .run/nginx-error.log -c $(1)
endef

define START_BACKEND
	LEVELBOARD_DB=.run/levelboard.db ./backend/bin/levelboard-backend >> .run/backend.log 2>&1 < /dev/null &
	echo $$! > .run/backend.pid
endef

define WAIT_URL
	@for i in $$(seq 1 60); do \
	  if curl -fsS -o /dev/null "$(1)"; then exit 0; fi; \
	  sleep 1; \
	done; \
	echo "Timeout: $(1) antwortet nicht"; \
	cat .run/*.log 2>/dev/null || true; \
	exit 1
endef

define LEVEL_STACK
	$(call BUILD_FRONTEND)
	$(call BUILD_BACKEND)
	$(call START_NGINX,frontend/nginx-api.conf)
	@rm -f .run/levelboard.db .run/levelboard.db-wal .run/levelboard.db-shm
	$(call START_BACKEND)
	@printf '{"source":"api"}\n' > frontend/dist/config.json
	@echo $(1) > .run/level
	$(call WAIT_URL,$(URL)/api/health)
	@echo "Levelboard läuft auf $(URL) (Quelle: Backend)"
	@echo "Backend läuft auf $(API_URL)"
	@echo "Datenbank: .run/levelboard.db"
endef

.PHONY: down stop-backend restart-backend level1 level2 level3 level4 level5 level6 level7 level8 level9 level10 check

down:
	@mkdir -p .run
	@for f in .run/frontend.pid .run/nginx.pid .run/backend.pid; do \
	  if [ -f "$$f" ]; then \
	    pid=$$(cat "$$f"); \
	    kill "$$pid" 2>/dev/null || true; \
	    for i in $$(seq 1 50); do \
	      if ! kill -0 "$$pid" 2>/dev/null; then break; fi; \
	      sleep 0.1; \
	    done; \
	  fi; \
	done
	@rm -f .run/frontend.pid .run/nginx.pid .run/backend.pid .run/level

stop-backend:
	@if [ -f .run/backend.pid ]; then \
	  pid=$$(cat .run/backend.pid); \
	  kill "$$pid" 2>/dev/null || true; \
	  for i in $$(seq 1 50); do \
	    if ! kill -0 "$$pid" 2>/dev/null; then break; fi; \
	    sleep 0.1; \
	  done; \
	fi
	@rm -f .run/backend.pid

restart-backend: stop-backend
	@mkdir -p .run
	$(call START_BACKEND)
	$(call WAIT_URL,$(API_URL)/api/health)
	@echo "Backend neu gestartet (Datenbank erhalten)"

level1: down
	@mkdir -p .run
	$(call BUILD_FRONTEND)
	@cd frontend && (exec ./node_modules/.bin/vite preview > ../.run/frontend.log 2>&1 < /dev/null) & echo $$! > .run/frontend.pid
	@echo 1 > .run/level
	$(call WAIT_URL,$(URL))
	@echo "Levelboard läuft auf $(URL)"

level2: down
	@mkdir -p .run
	$(call BUILD_FRONTEND)
	$(call START_NGINX,frontend/nginx.conf)
	@echo 2 > .run/level
	$(call WAIT_URL,$(URL))
	@echo "Levelboard läuft auf $(URL)"

level3: down
	@mkdir -p .run
	$(call BUILD_FRONTEND)
	$(call BUILD_BACKEND)
	$(call START_NGINX,frontend/nginx.conf)
	@rm -f .run/levelboard.db .run/levelboard.db-wal .run/levelboard.db-shm
	$(call START_BACKEND)
	@echo 3 > .run/level
	$(call WAIT_URL,$(URL))
	$(call WAIT_URL,$(API_URL)/api/health)
	@echo "Levelboard läuft auf $(URL)"
	@echo "Backend läuft auf $(API_URL)"

level4: down
	@mkdir -p .run
	$(call BUILD_FRONTEND)
	$(call BUILD_BACKEND)
	$(call START_NGINX,frontend/nginx.conf)
	@rm -f .run/levelboard.db .run/levelboard.db-wal .run/levelboard.db-shm
	$(call START_BACKEND)
	@echo 4 > .run/level
	$(call WAIT_URL,$(URL))
	$(call WAIT_URL,$(API_URL)/api/health)
	@echo "Levelboard läuft auf $(URL)"
	@echo "Backend läuft auf $(API_URL)"
	@echo "Datenbank: .run/levelboard.db"

level5: down
	$(call LEVEL_STACK,5)

level6: down
	$(call LEVEL_STACK,6)
	@echo "Repo: https://github.com/$(GITHUB_REPO)"

level7: down
	$(call LEVEL_STACK,7)
	@echo "Images: ghcr.io/$(GITHUB_REPO)-frontend und ghcr.io/$(GITHUB_REPO)-backend"

level8: down
	$(call LEVEL_STACK,8)
	@echo "Live: $(LIVE_URL)"

level9: down
	$(call LEVEL_STACK,9)
	@echo "Live-Prüfung gegen $(LIVE_URL)"

level10: down
	$(call LEVEL_STACK,10)
	@echo "Abschlussbericht: $(LIVE_URL)"

check:
	@mkdir -p checks/.out
	@if [ ! -d checks/node_modules ]; then (cd checks && npm ci); fi
	@(cd checks && npx playwright install chromium)
	@rm -f checks/.out/loadtest.json
	@export BASE_URL="$(URL)" API_URL="$(API_URL)" GITHUB_REPO="$(GITHUB_REPO)" RUN_ID="$(RUN_ID)" LIVE_URL="$(LIVE_URL)"; \
	  status=0; \
	  (cd checks && npx playwright test $(TESTFILES)) || status=$$?; \
	  write=0; \
	  (cd checks && REPORT_API="$(REPORT_API)" REPORT_LIVE="$(REPORT_LIVE)" node write-results.mjs $(LEVELS)) || write=$$?; \
	  if [ $$write -ne 0 ]; then status=$$write; fi; \
	  if [ $(LEVEL) -ge 10 ] && [ $$write -eq 0 ]; then \
	    (cd checks && npx playwright test tests/live-report.spec.ts --reporter=list) || status=$$?; \
	  fi; \
	  exit $$status
