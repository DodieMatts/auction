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

## Administrator Auction Routes

All administrator auction routes require an administrator bearer token.

```text
POST   /api/admin/auctions
GET    /api/admin/auctions
GET    /api/admin/auctions/:auctionId
PATCH  /api/admin/auctions/:auctionId
POST   /api/admin/auctions/:auctionId/publish
POST   /api/admin/auctions/:auctionId/cancel
```

Auction phases are derived from PostgreSQL time. Draft changes require `expectedVersion`.
Creation uses `creationRequestId` for idempotent retries. Cancellation uses
`cancellationRequestId`. Published auctions are immutable, started published auctions
cannot be cancelled, and auctions are never physically deleted.

Create a draft:

```json
{
  "creationRequestId": "00000000-0000-4000-8000-000000000001",
  "title": "Estate Auction",
  "description": "Local preview by appointment.",
  "currency": "USD",
  "startTime": "2027-01-01T15:00:00.000Z",
  "revealTime": "2027-01-01T16:00:00.000Z",
  "endTime": "2027-01-01T17:00:00.000Z"
}
```

Update a draft:

```json
{
  "expectedVersion": 0,
  "title": "Updated Estate Auction"
}
```

Publish a draft:

```json
{
  "expectedVersion": 1
}
```

Cancel an eligible auction:

```json
{
  "cancellationRequestId": "00000000-0000-4000-8000-000000000002",
  "expectedVersion": 2,
  "reason": "Administrative cancellation"
}
```

## Bidder Auction Discovery

Bidder auction routes require a bidder bearer token. Administrators use the
separate administrator routes.

```text
GET /api/auctions
GET /api/auctions/:auctionId
```

Draft and cancelled auctions remain hidden and return `404` from the detail
route. Published and settled auctions are visible. Auction phases are derived
from PostgreSQL time, and responses include the authoritative `serverTime`.
Bid records, user records, idempotency identifiers, version fields, and
settlement or cancellation metadata are excluded.

List visible auctions:

```bash
curl 'http://127.0.0.1:3001/api/auctions?page=1&limit=20' \
  -H 'Authorization: Bearer <bidder-access-token>'
```

Safe response shape:

```json
{
  "data": [
    {
      "id": "00000000-0000-4000-8000-000000000010",
      "title": "Estate Auction",
      "description": "Local preview by appointment.",
      "currency": "USD",
      "startTime": "2027-01-01T15:00:00.000Z",
      "revealTime": "2027-01-01T16:00:00.000Z",
      "endTime": "2027-01-01T17:00:00.000Z",
      "status": "PUBLISHED",
      "phase": "SCHEDULED"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 1,
    "totalPages": 1
  },
  "serverTime": "2026-07-26T18:00:00.000Z"
}
```

Verify bidder auction discovery with:

```bash
npm run verify:bidder-auction-integration --workspace apps/api
```

## Cryptographic Bid Commitments

Bid commitments are computed client-side with the shared `@auction/commitment`
package. The backend receives only a lowercase SHA-256 commitment hash, protocol
version, client request ID, and optional expected bid version. Prices and secrets
remain client-side and are rejected by API validation.

Protocol version one uses this formula:

```text
SHA-256(UTF-8(JSON.stringify(canonical-array)))
```

The canonical array order is exact:

```json
[
  "auction-bid-commitment-v1",
  1,
  "auction-uuid",
  "bidder-uuid",
  "USD",
  "12500",
  "base64url-secret"
]
```

Money is represented as decimal cent strings, never floating-point values. Version-one
secrets are 32 random bytes encoded as 43 unpadded base64url characters. Secrets
require secure local storage; losing a secret prevents later reveal verification.

Commitment routes:

```text
POST /api/auctions/:auctionId/commitments
GET  /api/auctions/:auctionId/participation
```

Both routes require a bidder bearer token. PostgreSQL time controls commitment
windows, and only commit-phase published auctions accept new commitments. Replacing
a commitment requires the current bid version. Exact retries use `clientRequestId`
and return the existing commitment without creating duplicate history.

Submit a commitment:

```json
{
  "clientRequestId": "00000000-0000-4000-8000-000000000020",
  "commitmentHash": "fcc6de5f47975bc6a04cde64a7b93d23c229d97553d385828d0e3c3d5fa398c2",
  "protocolVersion": 1,
  "expectedBidVersion": 0
}
```

Check participation:

```bash
curl http://127.0.0.1:3001/api/auctions/<auction-id>/participation \
  -H 'Authorization: Bearer <bidder-access-token>'
```

Verify the commitment protocol and API integration with:

```bash
npm run verify:commitment-protocol
npm run verify:bid-commitment-integration --workspace apps/api
```
