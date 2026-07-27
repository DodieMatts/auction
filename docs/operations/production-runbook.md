# Production Runbook

## Startup

1. Confirm `.env.production` exists and every placeholder has been replaced.
2. Confirm Docker and Node `20.19.0` are installed.
3. Review pending migrations and the release image changes.
4. Start the stack:

```bash
npm run containers:up
npm run containers:status
```

5. Confirm readiness:

```bash
curl -i http://127.0.0.1:8080/healthz
curl -i http://127.0.0.1:8080/api/system/health
```

Expose the stack to users only through an HTTPS-terminating external proxy.

## Migration Failures

Inspect the migration logs and database connectivity:

```bash
docker compose --env-file .env.production -f docker-compose.production.yml logs migrate
docker compose --env-file .env.production -f docker-compose.production.yml ps
```

The API must remain stopped until the migration exits successfully. Do not
replace `migrate deploy` with `migrate dev` or `db push`, and do not run a
second migration process concurrently.

## Service Failures

- API failure: check `api` logs, database readiness, and the API health route.
- Web failure: check `web` logs and whether its server-only `API_BASE_URL` can
  reach `api` on the internal network.
- Database failure: check PostgreSQL logs, volume capacity, credentials, and
  connection limits.
- Nginx failure: check the mounted configuration and whether `web` is healthy.

```bash
docker compose --env-file .env.production -f docker-compose.production.yml logs --no-color api web postgres nginx
```

## Restart And Shutdown

Use Compose stop operations so SIGTERM reaches the application processes:

```bash
docker compose --env-file .env.production -f docker-compose.production.yml stop api web nginx
docker compose --env-file .env.production -f docker-compose.production.yml up -d
```

Emergency shutdown may use `docker compose ... down`, but preserve logs first.
Do not remove the database volume as part of an ordinary restart.

## Upgrade And Rollback

Review release notes and migrations before building. Build the new images,
keep the database volume, start the migration service, and verify readiness
before routing traffic. Rollback is release- and migration-dependent; preserve
the volume and use a previously verified image only after checking schema
compatibility.

## Responsibilities

Operators are responsible for database backups, restore testing, secret
rotation, TLS certificates, host hardening, and monitoring. This repository
does not claim to automate backups or provide a monitoring service.
