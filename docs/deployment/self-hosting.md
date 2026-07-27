# Self-Hosting

This repository provides a production-like Docker Compose stack. It does not
deploy to a cloud provider, publish images, provision TLS, or create secrets.

## Architecture

The stack contains PostgreSQL, a one-shot Prisma migration service, the
NestJS API, the Next.js standalone server, and an unprivileged Nginx reverse
proxy. PostgreSQL, the API, and the web server share a dedicated internal
Docker network. Only Nginx publishes `127.0.0.1:8080`.

Browser traffic terminates at Nginx and reaches Next.js. Next.js remains the
browser-facing boundary for authentication and application API handlers; the
NestJS API is not exposed through a host port.

## Requirements

- Node.js `20.19.0` for local commands and CI.
- Docker Engine with Docker Compose v2.
- A host or external reverse proxy capable of terminating HTTPS.

Production authentication requires HTTPS. Local HTTP on port 8080 is only a
smoke-test configuration and is not production security.

## Environment Preparation

Copy the example and replace every placeholder with deployment-specific values:

```bash
cp .env.production.example .env.production
```

Use a strong, unique JWT secret of at least 32 characters. Keep the database
password URL-encoded inside `DATABASE_URL` when it contains URL-reserved
characters. Never commit `.env.production`.

## Build And Start

```bash
npm run containers:build
npm run containers:up
npm run containers:status
```

The repository scripts pass `.env.production` explicitly to Compose. The
`migrate` service runs `prisma migrate deploy` after PostgreSQL is healthy.
The API starts only after that service exits successfully. Migrations are not
run during image builds and production is not seeded automatically.

## Health Verification

```bash
curl -i http://127.0.0.1:8080/healthz
curl -i http://127.0.0.1:8080/api/system/health
```

`/healthz` only confirms that Nginx is serving. Application readiness is
`/api/system/health`, which reports the API and database state through the
Next.js health proxy.

Inspect logs with:

```bash
npm run containers:logs
```

## Shutdown And Upgrades

```bash
npm run containers:down
```

For an upgrade, review the release and migrations, build the new images, stop
the stack gracefully, and start it again. Confirm migration completion and
both readiness endpoints before accepting traffic. Do not remove the named
PostgreSQL volume during routine upgrades.

Rollback depends on the migration compatibility of the release. Stop the
stack, preserve logs and the database volume, and use the previously verified
image versions. Do not run destructive rollback commands without a verified
database backup and an explicit recovery decision.

## Reverse Proxy And TLS

Nginx is intentionally configured as an internal local reverse proxy on port
8080. A public reverse proxy or load balancer must terminate TLS, forward the
original host and scheme, and route only to Nginx. Configure HSTS only at the
TLS-terminating layer after HTTPS is confirmed. Do not expose the API,
Next.js, or PostgreSQL ports directly.

## Persistence

PostgreSQL uses the named `auction_production_data` volume at the PostgreSQL 18
mount path `/var/lib/postgresql`. Backup and restore responsibility remains
with the operator; this repository does not claim to provide automated backups.
