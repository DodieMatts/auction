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

## Local Frontend Workflow

Create the frontend environment file, install dependencies, and start the Next.js
development server:

```bash
cp apps/web/.env.example apps/web/.env.local
npm install
npm run web:dev
```

Local addresses:

```text
Frontend: http://127.0.0.1:3000
Backend:  http://127.0.0.1:3001/api
```

Run frontend checks with:

```bash
npm run web:lint
npm run web:typecheck
npm run web:build
npm run verify:web-foundation
```

`API_BASE_URL` remains server-only. The browser calls the same-origin Next.js
layer, including `/api/system/health`, and the Next.js server talks to the
backend. Frontend authentication, auction screens, and bidding screens remain
unimplemented.

## Frontend Authentication

Start the local stack for authenticated frontend work:

```bash
npm run db:up
npm run db:seed --workspace apps/api
npm run start:dev --workspace apps/api
npm run web:dev
```

Frontend routes:

```text
/login
/admin
/auctions
```

Browser-facing authentication handlers:

```text
POST /api/auth/login
POST /api/auth/logout
GET  /api/auth/session
```

The browser posts credentials only to the same-origin Next.js login handler.
Next.js forwards credentials to the NestJS backend, stores the returned backend
JWT in one HTTP-only cookie, and returns only safe user data plus the
role-specific redirect path. Browser JavaScript cannot read JWTs.

The session cookie is `HttpOnly`, `SameSite=Lax`, `Path=/`, `Priority=High`,
`Secure` in production, and expires with the backend access token after fifteen
minutes. No refresh token exists.

Proxy performs optimistic checks using cookie presence only for `/admin` and
`/auctions`. Server layouts perform authoritative checks by calling backend
`/auth/me`; roles come from the NestJS backend, not from browser state or decoded
JWT claims. Administrators are sent to `/admin`, bidders are sent to `/auctions`,
and incompatible return paths are ignored to prevent open redirects.

Run frontend authentication verification with:

```bash
npm run verify:web-authentication
```

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

## Bid Revelation

Bid reveals submit the integer-cent amount and original secret during the reveal
phase. The backend recomputes the canonical commitment with `@auction/commitment`
and compares the submitted reveal against the current commitment in constant time.
Secrets are stored only as audit evidence and never appear in API responses.

Reveal routes:

```text
POST /api/auctions/:auctionId/reveals
GET  /api/auctions/:auctionId/reveal-status
```

Both routes require a bidder bearer token. New reveals are accepted only while
PostgreSQL time places a published auction in reveal phase:

```text
revealTime <= database time < endTime
```

Exact retries use `clientRequestId` and return the original result, including
after the auction closes. Invalid commitment matches are permanently audited and
may be corrected with another reveal while the reveal window remains open. A valid
reveal finalizes the logical bid as `REVEALED`, increments the bid version once,
and prevents additional valid reveal attempts.

Submit a reveal:

```json
{
  "clientRequestId": "00000000-0000-4000-8000-000000000030",
  "amountCents": "12500",
  "secret": "<43-character-base64url-secret>",
  "expectedBidVersion": 1
}
```

Check reveal status:

```bash
curl http://127.0.0.1:3001/api/auctions/<auction-id>/reveal-status \
  -H 'Authorization: Bearer <bidder-access-token>'
```

HTTP outcomes:

```text
201 valid reveal
400 malformed input
401 unauthenticated
403 wrong role
404 hidden auction
409 lifecycle, version, or idempotency conflict
422 commitment mismatch
```

Verify reveal integration with:

```bash
npm run verify:bid-reveal-integration --workspace apps/api
```

## Auction Settlement

Auction settlement is administrator-controlled and transactional. Settlement is
available only after a published auction has ended according to PostgreSQL time.

```text
POST /api/admin/auctions/:auctionId/settle
```

Administrator authentication is required. The request supplies a
`settlementRequestId` for exact retries and an `expectedVersion` for optimistic
auction concurrency control.

```json
{
  "settlementRequestId": "00000000-0000-4000-8000-000000000040",
  "expectedVersion": 3
}
```

Winning rules are deterministic:

```text
1. Highest valid revealed amount
2. Earliest current commitment time
3. Lexicographically smallest bid ID
```

Only valid revealed bids can win. Losing valid revealed bids become `LOST`.
Unrevealed committed bids become `INVALID`. Auctions may settle without a winner,
including auctions with no bids. Exact retries return the existing settlement
without incrementing versions again. Settlement responses expose only the winner
amount; losing amounts, secrets, hashes, request identifiers, and invalid reveal
details remain private.

HTTP outcomes:

```text
200 settled or exact retry
400 malformed input
401 unauthenticated
403 wrong role
404 unknown auction
409 lifecycle, version, or identifier conflict
500 inconsistent auction data
```

Verify settlement integration with:

```bash
npm run verify:auction-settlement-integration --workspace apps/api
```

## Auction Results

Auction results are authenticated and available only after settlement. Result
reads use finalized bid statuses and never modify auction, bid, commitment, or
reveal records.

```text
GET /api/auctions/:auctionId/results
GET /api/admin/auctions/:auctionId/results
```

Bidder results require a bidder bearer token. Draft and cancelled auctions remain
hidden with `404`; published but unsettled auctions return `409`. Settled auction
results include auction details, the winning amount when there is a winner,
aggregate counts, authoritative server time, and the requesting bidder's own
outcome.

Bidder outcomes:

```text
NOT_PARTICIPATED
WON
LOST
INVALID
```

Bidders never receive winner identity, other bidder identities, other losing
amounts, invalid reveal details, secrets, commitment hashes, or request
identifiers. Bidders may see only their own revealed amount.

Administrator results require an administrator bearer token. Administrators may
see the winning bidder ID, winning bidder email, winning amount, and aggregate
settlement counts. Administrator responses still exclude losing amounts, losing
bidder identities, reveal secrets, commitment hashes, invalid reveal details,
password hashes, and request identifiers.

Bidder result example:

```json
{
  "auction": {
    "id": "00000000-0000-4000-8000-000000000050",
    "title": "Example auction",
    "description": "Example description",
    "currency": "USD",
    "startTime": "2026-01-01T15:00:00.000Z",
    "revealTime": "2026-01-01T16:00:00.000Z",
    "endTime": "2026-01-01T17:00:00.000Z",
    "status": "SETTLED",
    "phase": "SETTLED",
    "settledAt": "2026-01-01T17:05:00.000Z"
  },
  "result": {
    "winner": {
      "amountCents": "12500"
    },
    "totalBidCount": 3,
    "validRevealCount": 2,
    "invalidBidCount": 1,
    "yourOutcome": {
      "status": "LOST",
      "amountCents": "11000"
    }
  },
  "serverTime": "2026-01-01T17:10:00.000Z"
}
```

HTTP outcomes:

```text
200 results available
401 unauthenticated
403 wrong role
404 unknown or hidden auction
409 results unavailable
500 inconsistent result data
```

Verify result integration with:

```bash
npm run verify:auction-results-integration --workspace apps/api
```

## Administrator Auction UI

The Next.js administrator dashboard provides the browser-facing auction
management workspace. It keeps JWTs inside HTTP-only cookies and sends browser
requests only to same-origin Next.js route handlers.

Pages:

```text
/admin
/admin/auctions
/admin/auctions/new
/admin/auctions/:auctionId
```

Browser-facing handlers:

```text
GET    /api/admin/auctions
POST   /api/admin/auctions
GET    /api/admin/auctions/:auctionId
PATCH  /api/admin/auctions/:auctionId
POST   /api/admin/auctions/:auctionId/publish
POST   /api/admin/auctions/:auctionId/cancel
POST   /api/admin/auctions/:auctionId/settle
```

The dashboard uses warm-neutral styling with cream modules on a contrasting
neutral background. Green marks successful or final states, orange marks pending
or timed lifecycle states, red marks failed or cancelled states, and every status
also includes text and a symbol.

Supported administrator workflows:

```text
View dashboard summaries
List auctions with pagination and status filtering
Create draft auctions
View auction details
Edit draft auctions
Publish draft auctions
Cancel eligible auctions
Settle ended auctions
View administrator-safe settlement results
```

Auction versions protect draft edits and lifecycle actions from concurrent
overwrites. Creation uses `creationRequestId`, cancellation uses
`cancellationRequestId`, and settlement uses `settlementRequestId` for safe
idempotent retries. PostgreSQL time remains authoritative for lifecycle
eligibility.

JWTs remain browser-inaccessible. Browser requests remain same-origin. Result
views show administrator-safe winner information only; losing amounts,
commitment hashes, reveal secrets, and request identifiers stay hidden.

Verify the administrator UI with:

```bash
npm run web:lint
npm run web:typecheck
npm run web:build
npm run verify:web-foundation
npm run verify:web-authentication
npm run verify:web-admin-auctions
```

## Bidder Auction UI

The Next.js bidder dashboard provides the authenticated auction browsing,
commitment, reveal, participation, and personal result experience. JWTs remain
inside HTTP-only cookies. Client components call only same-origin Next.js
handlers; they never call the NestJS API directly.

Pages:

```text
/auctions
/auctions/:auctionId
```

Browser-facing handlers:

```text
GET  /api/auctions
GET  /api/auctions/:auctionId
GET  /api/auctions/:auctionId/participation
POST /api/auctions/:auctionId/commitments
GET  /api/auctions/:auctionId/reveal-status
POST /api/auctions/:auctionId/reveals
GET  /api/auctions/:auctionId/results
```

Commitments are generated inside the browser with `@auction/commitment`.
During commitment submission, amounts and secrets stay client-side; the
same-origin handler sends only `clientRequestId`, `commitmentHash`,
`protocolVersion`, and `expectedBidVersion` to the backend.

Reveal receipts are the recovery mechanism. After a commitment succeeds, the UI
offers a downloadable and copyable receipt containing the amount, secret, bid
metadata, and commitment hash needed for later reveal. The app does not store
receipts automatically and does not use persistent browser storage. Lost
receipts cannot be recovered. Replacing a commitment invalidates older receipts.

During reveal, bidders import a JSON receipt by file upload or paste. The
browser validates that receipt locally by recomputing the commitment before the
same-origin reveal handler sends `amountCents`, `secret`,
`expectedBidVersion`, and a reveal `clientRequestId` to the backend.

PostgreSQL time remains authoritative for commitment and reveal windows.
Countdowns use the backend `serverTime` only as an informational display.
Settled result views show the winning amount, aggregate counts, and the
requesting bidder's own outcome. Winner identities, other losing amounts,
commitment hashes, reveal secrets, and request identifiers remain hidden from
bidder result views.

Receipt warning:

```text
Save the latest reveal receipt immediately.
The bid cannot be revealed without it.
The application cannot recover lost receipts.
```

Verify the bidder UI with:

```bash
npm run web:lint
npm run web:typecheck
npm run web:build
npm run verify:web-foundation
npm run verify:web-authentication
npm run verify:web-admin-auctions
npm run verify:web-bidder-auctions
```
