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
