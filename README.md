# auction
An auction house with a single-page frontend, a backend, and a database.

## Local Database Workflow

Use Node.js `20.19+`, `22.12+`, or `24+` for the current stable Prisma CLI.

Install dependencies and create local environment files:

```bash
npm install
cp .env.example .env
cp apps/api/.env.example apps/api/.env
```

Start PostgreSQL and verify the Compose service:

```bash
npm run db:up
npm run db:status
```

Validate the Prisma schema from the backend workspace:

```bash
npm run db:validate --workspace apps/api
```

Stop PostgreSQL when you are done:

```bash
npm run db:down
```

Follow PostgreSQL logs:

```bash
npm run db:logs
```

Open Prisma Studio:

```bash
npm run db:studio --workspace apps/api
```

Warning: `docker compose down -v` permanently deletes the local PostgreSQL volume and all local database data.

## Local API Workflow

Use the configured Node.js version, start PostgreSQL, build the API, and run the development server:

```bash
nvm use
npm run db:up
npm run build --workspace apps/api
npm run start:dev --workspace apps/api
```

The API listens under the `/api` prefix by default. Health checks are available at:

```bash
curl http://127.0.0.1:3001/api/health/live
curl http://127.0.0.1:3001/api/health/ready
```

`live` checks the API process only. `ready` checks both the API process and PostgreSQL.

Run the API integration verification with:

```bash
npm run verify:api-integration --workspace apps/api
```

## Local Authentication Workflow

Seed local development users before starting the API:

```bash
nvm use
npm run db:up
npm run db:seed --workspace apps/api
npm run start:dev --workspace apps/api
```

Development credentials are local-only and come from `apps/api/.env`.
Production seeding is blocked.

Authenticate with:

```bash
curl -X POST http://127.0.0.1:3001/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@auction.local","password":"AuctionAdmin123!"}'
```

Read the current authenticated user with:

```bash
curl http://127.0.0.1:3001/api/auth/me \
  -H 'Authorization: Bearer <access-token>'
```

Access tokens expire after fifteen minutes. Refresh tokens are intentionally excluded for now.

Verify authentication integration with:

```bash
npm run verify:auth-integration --workspace apps/api
```
