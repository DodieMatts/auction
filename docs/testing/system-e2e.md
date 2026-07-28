# System E2E Testing

The system E2E suite runs the built NestJS API, the built Next.js frontend, real PostgreSQL records, and Chromium through Playwright. It is intended to validate complete user workflows rather than isolated components.

## Requirements

- Node.js `20.19.0`
- PostgreSQL reachable through the backend `DATABASE_URL`
- Current Prisma migrations applied
- Playwright Chromium installed with `npm run test:e2e:install`

## Ports

The full verifier uses fixed local ports:

- Frontend: `http://localhost:3119`
- Backend API: `http://127.0.0.1:3120/api`

The frontend receives `API_BASE_URL=http://127.0.0.1:3120/api` as a server-only environment value. Browser tests must not call the backend port directly.

## Run The Full Verifier

```bash
npm run verify:system-e2e
```

The verifier:

1. Checks Node and PostgreSQL reachability.
2. Checks Prisma migration status.
3. Builds `@auction/commitment`.
4. Builds `apps/api`.
5. Builds `@auction/web`.
6. Starts production API and frontend servers.
7. Runs Playwright with Chromium.
8. Cleans temporary E2E database records.
9. Stops every child process.

## Run Playwright Directly

Start the production API and frontend first, then run:

```bash
npm run test:e2e --workspace @auction/web
```

Run one file:

```bash
npm run test:e2e --workspace @auction/web -- e2e/authentication.spec.ts
```

Run headed:

```bash
npm run test:e2e:headed --workspace @auction/web
```

Use Playwright UI mode for local debugging:

```bash
npm run test:e2e:ui --workspace @auction/web
```

## Reports And Artifacts

Playwright is configured to retain traces, screenshots, and video only on failures. HTML reports are written under `apps/web/playwright-report/` and are ignored by Git.

## Test Data

Each run uses a unique `e2e-<uuid>` namespace for users and auction titles. Cleanup deletes only records matching that namespace. Tests never depend on existing development users or auctions.

## Phase Manipulation

Tests may directly adjust auction timestamps in the database to create deterministic commit, reveal, and ended phases. This is test-only database setup; production timing remains controlled by PostgreSQL time and backend lifecycle rules.

## Privacy Guarantees

The suite checks that browser responses and visible pages do not expose JWTs, database URLs, password hashes, reveal secrets, commitment hashes, idempotency identifiers, or other bidders' private losing amounts.
