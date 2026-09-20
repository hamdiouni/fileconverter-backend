# ═══════════════════════════════════════════════════════════════════════════
# FileConverter Pro – Development Makefile
# ═══════════════════════════════════════════════════════════════════════════
#
# Usage:
#   make up          Start all services (builds images if needed)
#   make down        Stop and remove containers
#   make restart     Restart all containers
#   make logs        Tail logs from all services
#   make migrate     Run Prisma database migrations
#   make seed        Seed the database with development data
#   make build       (Re)build all Docker images
#   make ps          Show container status
#   make clean       Remove containers, volumes, and built images
#   make infra-up    Start only infrastructure services (postgres, redis, minio)
#   make infra-down  Stop only infrastructure services
#   make test        Run the full test suite across all workspace packages
#   make typecheck   Run TypeScript type checking across all packages
#   make lint        Run ESLint across all packages
#   make format      Run Prettier formatter across all packages
#   make shell       Open a shell in a running service container
#                    Usage: make shell SERVICE=auth-service
#
# ═══════════════════════════════════════════════════════════════════════════

COMPOSE        = docker compose
COMPOSE_FILE   = -f docker-compose.yml
COMPOSE_PROD   = -f docker-compose.yml -f docker-compose.prod.yml
ENV_FILE       = --env-file .env

# Colours for output
CYAN   = \033[0;36m
RESET  = \033[0m
BOLD   = \033[1m

.DEFAULT_GOAL := help

# ─── Help ────────────────────────────────────────────────────────────────────

.PHONY: help
help: ## Show this help message
	@echo ""
	@echo "  $(BOLD)FileConverter Pro$(RESET) – available commands:"
	@echo ""
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
		| sort \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  $(CYAN)%-18s$(RESET) %s\n", $$1, $$2}'
	@echo ""

# ─── Docker Compose helpers ─────────────────────────────────────────────────

.PHONY: up
up: .env ## Start all services in the background
	@echo "$(CYAN)Starting all services...$(RESET)"
	$(COMPOSE) $(COMPOSE_FILE) $(ENV_FILE) up -d --build
	@echo "$(CYAN)Services started. API Gateway: http://localhost$(RESET)"
	@echo "  MinIO console : http://localhost:9001"
	@echo "  Mailhog UI    : http://localhost:8025"

.PHONY: down
down: ## Stop and remove all containers (preserves volumes)
	@echo "$(CYAN)Stopping all services...$(RESET)"
	$(COMPOSE) $(COMPOSE_FILE) down

.PHONY: restart
restart: down up ## Restart all containers

.PHONY: build
build: ## Rebuild all Docker images without cache
	@echo "$(CYAN)Building images...$(RESET)"
	$(COMPOSE) $(COMPOSE_FILE) $(ENV_FILE) build --no-cache

.PHONY: ps
ps: ## Show container status
	$(COMPOSE) $(COMPOSE_FILE) ps

.PHONY: logs
logs: ## Tail logs from all services (Ctrl-C to stop)
	$(COMPOSE) $(COMPOSE_FILE) logs -f

.PHONY: logs-service
logs-service: ## Tail logs from a specific service: make logs-service SERVICE=auth-service
	$(COMPOSE) $(COMPOSE_FILE) logs -f $(SERVICE)

.PHONY: clean
clean: ## Stop containers and REMOVE volumes (destructive – deletes all data)
	@echo "$(CYAN)Removing containers and volumes...$(RESET)"
	$(COMPOSE) $(COMPOSE_FILE) down -v --remove-orphans
	@echo "Done."

# ─── Infra-only commands ─────────────────────────────────────────────────────

.PHONY: infra-up
infra-up: .env ## Start only infrastructure services (postgres, redis, minio, mailhog)
	@echo "$(CYAN)Starting infrastructure services...$(RESET)"
	$(COMPOSE) $(COMPOSE_FILE) $(ENV_FILE) up -d postgres redis minio minio-init mailhog clamav

.PHONY: infra-down
infra-down: ## Stop only infrastructure services
	$(COMPOSE) $(COMPOSE_FILE) stop postgres redis minio mailhog clamav

# ─── Database ────────────────────────────────────────────────────────────────

.PHONY: migrate
migrate: ## Run Prisma database migrations (applies pending migrations)
	@echo "$(CYAN)Running database migrations...$(RESET)"
	$(COMPOSE) $(COMPOSE_FILE) $(ENV_FILE) run --rm \
		-e DATABASE_URL=postgresql://$${POSTGRES_USER:-fileconverter}:$${POSTGRES_PASSWORD:-fileconverter_dev}@postgres:5432/$${POSTGRES_DB:-fileconverter} \
		orchestrator-service \
		npx prisma migrate deploy
	@echo "$(CYAN)Migrations complete.$(RESET)"

.PHONY: migrate-dev
migrate-dev: ## Create and apply a new Prisma migration (dev only): make migrate-dev NAME=add_users
	@echo "$(CYAN)Creating migration: $(NAME)$(RESET)"
	$(COMPOSE) $(COMPOSE_FILE) $(ENV_FILE) run --rm \
		-e DATABASE_URL=postgresql://$${POSTGRES_USER:-fileconverter}:$${POSTGRES_PASSWORD:-fileconverter_dev}@postgres:5432/$${POSTGRES_DB:-fileconverter} \
		orchestrator-service \
		npx prisma migrate dev --name $(NAME)

.PHONY: migrate-reset
migrate-reset: ## DANGER: Reset database and re-apply all migrations (dev only)
	@echo "$(CYAN)WARNING: This will drop all data!$(RESET)"
	@read -p "Are you sure? [y/N] " confirm && [ "$$confirm" = "y" ]
	$(COMPOSE) $(COMPOSE_FILE) $(ENV_FILE) run --rm \
		-e DATABASE_URL=postgresql://$${POSTGRES_USER:-fileconverter}:$${POSTGRES_PASSWORD:-fileconverter_dev}@postgres:5432/$${POSTGRES_DB:-fileconverter} \
		orchestrator-service \
		npx prisma migrate reset --force

.PHONY: seed
seed: ## Seed the database with development data
	@echo "$(CYAN)Seeding database...$(RESET)"
	$(COMPOSE) $(COMPOSE_FILE) $(ENV_FILE) run --rm \
		-e DATABASE_URL=postgresql://$${POSTGRES_USER:-fileconverter}:$${POSTGRES_PASSWORD:-fileconverter_dev}@postgres:5432/$${POSTGRES_DB:-fileconverter} \
		orchestrator-service \
		npx ts-node packages/prisma/src/seed.ts
	@echo "$(CYAN)Database seeded.$(RESET)"

.PHONY: prisma-studio
prisma-studio: ## Open Prisma Studio (database GUI) on port 5555
	$(COMPOSE) $(COMPOSE_FILE) $(ENV_FILE) run --rm -p 5555:5555 \
		-e DATABASE_URL=postgresql://$${POSTGRES_USER:-fileconverter}:$${POSTGRES_PASSWORD:-fileconverter_dev}@postgres:5432/$${POSTGRES_DB:-fileconverter} \
		orchestrator-service \
		npx prisma studio

# ─── Development / Testing ───────────────────────────────────────────────────

.PHONY: test
test: ## Run the full test suite across all workspace packages
	@echo "$(CYAN)Running tests...$(RESET)"
	npm run test --workspaces --if-present

.PHONY: test-service
test-service: ## Run tests for a specific service: make test-service SERVICE=auth-service
	@echo "$(CYAN)Running tests for $(SERVICE)...$(RESET)"
	npm run test --workspace=services/$(SERVICE)

.PHONY: typecheck
typecheck: ## Run TypeScript type checking across all packages
	@echo "$(CYAN)Type checking...$(RESET)"
	npm run typecheck --workspaces --if-present

.PHONY: lint
lint: ## Run ESLint across all packages
	@echo "$(CYAN)Running linter...$(RESET)"
	npm run lint --workspaces --if-present

.PHONY: format
format: ## Format code with Prettier
	@echo "$(CYAN)Formatting code...$(RESET)"
	npx prettier --write "services/**/*.ts" "packages/**/*.ts"

# ─── Utility ─────────────────────────────────────────────────────────────────

.PHONY: shell
shell: ## Open a shell in a running service container: make shell SERVICE=auth-service
	$(COMPOSE) $(COMPOSE_FILE) exec $(SERVICE) sh

.PHONY: redis-cli
redis-cli: ## Open a Redis CLI session
	$(COMPOSE) $(COMPOSE_FILE) exec redis redis-cli --no-auth-warning -a $${REDIS_PASSWORD:-redis_dev_password}

.PHONY: psql
psql: ## Open a PostgreSQL CLI session
	$(COMPOSE) $(COMPOSE_FILE) exec postgres psql -U $${POSTGRES_USER:-fileconverter} -d $${POSTGRES_DB:-fileconverter}

# ─── Production helpers ──────────────────────────────────────────────────────

.PHONY: up-prod
up-prod: ## Start all services using production compose overrides
	@echo "$(CYAN)Starting production services...$(RESET)"
	$(COMPOSE) $(COMPOSE_PROD) $(ENV_FILE) up -d

.PHONY: down-prod
down-prod: ## Stop production services
	$(COMPOSE) $(COMPOSE_PROD) down

# ─── Env file guard ──────────────────────────────────────────────────────────

.env:
	@echo "$(CYAN).env file not found. Copying from .env.example...$(RESET)"
	cp .env.example .env
	@echo "$(CYAN).env created. Please review and update values before running services.$(RESET)"
