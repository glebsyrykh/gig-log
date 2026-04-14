# gig·log

Personal music events history — gigs, festivals, venues, and stats.

## Quick start

```bash
# 1. Configure secrets
cp .env.example .env
# Edit .env — set DB_PASSWORD and ADMIN_TOKEN to strong random values
# Generate a token: openssl rand -hex 24

# 2. Start everything
docker compose up --build -d

# 3. Open http://localhost:3000
```

First run creates the schema and test seeds.

## Architecture

```
frontend/    React (Vite) → nginx (static + /api proxy)
backend/     Go (chi + pgx) → REST API
db/          PostgreSQL schema + seed data
```

Only port 3000 (nginx) is exposed. Database and backend are on an internal Docker network — not reachable from outside.

## Admin access

The admin panel is hidden. To enter:

- URL: `yoursite.com?admin` or `yoursite.com#admin`
- Keyboard: `Ctrl+Shift+A`

Enter your `ADMIN_TOKEN` value to authenticate write operations.

## Security

- **No exposed ports** for database or backend — only nginx on port 3000
- **Constant-time token comparison** prevents timing attacks on admin auth
- **Rate limiting** — 60 req/min per IP for public, 20 req/min for admin writes
- **500ms delay on failed auth** slows brute-force attempts
- **1MB request body limit** on both nginx and Go
- **CORS locked down** — no cross-origin by default; set `ALLOWED_ORIGINS` if needed
- **Security headers**: CSP, X-Frame-Options DENY, nosniff, Referrer-Policy
- **Server version hidden** in nginx responses
- **Secrets via env vars** — never hardcoded, `.env` is gitignored

## Environment variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DB_PASSWORD` | Yes | — | PostgreSQL password |
| `ADMIN_TOKEN` | Yes | — | Admin API auth token (16+ chars) |
| `DB_USER` | No | `giglog` | PostgreSQL user |
| `DB_NAME` | No | `giglog` | PostgreSQL database |
| `PORT` | No | `3000` | Public port |
| `ALLOWED_ORIGINS` | No | same-origin | CORS origins (comma-separated) |
| `RATE_LIMIT` | No | `60` | Requests per minute per IP |

## Production checklist

- [ ] Set strong `DB_PASSWORD` and `ADMIN_TOKEN` in `.env`
- [ ] Put behind a reverse proxy with HTTPS (Caddy, Traefik, Cloudflare Tunnel)
- [ ] Set `ALLOWED_ORIGINS` to your domain
- [ ] Consider adding Cloudflare or similar WAF in front
- [ ] Back up the `pgdata` Docker volume

## HTTPS

The easiest approach is Caddy as a reverse proxy in front:

```
# Caddyfile
gigs.yourdomain.com {
    reverse_proxy localhost:3000
}
```

Caddy handles TLS certificates automatically.

## Commands

```bash
docker compose up --build -d    # Start
docker compose down              # Stop
docker compose logs -f           # Logs
docker compose down -v           # Reset database (wipes volume)
```
