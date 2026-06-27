COMPOSE_FILE ?= infra/docker/docker-compose.yml
ENV ?= local
ENV_FILE ?= infra/env/$(ENV).env

.PHONY: local-up local-down local-ps local-logs local-test-live stack-up stack-down stack-ps stack-logs test test-unit test-ontology

test:
	npm test

test-unit:
	npm run test:unit

test-ontology:
	npm run test:ontology

local-up:
	docker compose --env-file infra/env/local.env -f $(COMPOSE_FILE) up -d

local-down:
	docker compose --env-file infra/env/local.env -f $(COMPOSE_FILE) down

local-ps:
	docker compose --env-file infra/env/local.env -f $(COMPOSE_FILE) ps

local-logs:
	docker compose --env-file infra/env/local.env -f $(COMPOSE_FILE) logs -f

local-test-live:
	set -a; . infra/env/local.env; set +a; docker compose -f $(COMPOSE_FILE) up -d; npm run test:ontology; npm run test:security; npm test

stack-up:
	docker compose --env-file $(ENV_FILE) -f $(COMPOSE_FILE) up -d

stack-down:
	docker compose --env-file $(ENV_FILE) -f $(COMPOSE_FILE) down

stack-ps:
	docker compose --env-file $(ENV_FILE) -f $(COMPOSE_FILE) ps

stack-logs:
	docker compose --env-file $(ENV_FILE) -f $(COMPOSE_FILE) logs -f
