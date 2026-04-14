.PHONY: up down build logs tidy

# Start all services
up:
	docker compose up --build -d

# Stop all services
down:
	docker compose down

# Rebuild and restart
build:
	docker compose up --build -d --force-recreate

# View logs
logs:
	docker compose logs -f

# Generate go.sum locally (requires Go installed)
tidy:
	cd backend && go mod tidy

# Reset database (deletes volume, re-seeds on next start)
reset-db:
	docker compose down -v
	docker compose up --build -d
