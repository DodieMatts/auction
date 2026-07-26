import "dotenv/config";
import { randomUUID } from "node:crypto";
import pg from "pg";

const { Client } = pg;

const requiredTables = [
  "User",
  "Auction",
  "Bid",
  "BidCommitment",
  "BidRevealAttempt",
];

const client = new Client({
  connectionString: process.env.DATABASE_URL,
});

let savepointCounter = 0;
let transactionStarted = false;

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function expectPgError(label, expected, action) {
  const savepoint = `schema_verify_${++savepointCounter}`;

  await client.query(`SAVEPOINT ${savepoint}`);

  let error;
  let succeeded = false;

  try {
    await action();
    succeeded = true;
  } catch (caught) {
    error = caught;
  }

  await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
  await client.query(`RELEASE SAVEPOINT ${savepoint}`);

  if (succeeded) {
    throw new Error(`${label}: expected PostgreSQL error, but query succeeded`);
  }

  const codeMatches = expected.codes.includes(error?.code);
  const constraintMatches =
    expected.constraints.length === 0 ||
    expected.constraints.includes(error?.constraint);

  if (!codeMatches || !constraintMatches) {
    throw new Error(
      `${label}: expected ${expected.codes.join(", ")} on ${expected.constraints.join(", ")}, got ${error?.code ?? "unknown"} on ${error?.constraint ?? "unknown"}`,
      { cause: error },
    );
  }

  console.log(`ok - ${label}`);
}

async function insertUser(email, role) {
  const id = randomUUID();

  await client.query(
    `
      INSERT INTO "User" ("id", "email", "passwordHash", "role", "updatedAt")
      VALUES ($1, $2, $3, $4, NOW())
    `,
    [id, email, "verified-password-hash", role],
  );

  return id;
}

async function main() {
  assert(process.env.DATABASE_URL, "DATABASE_URL is required");

  await client.connect();
  await client.query("BEGIN");
  transactionStarted = true;

  const adminId = await insertUser(`admin-${randomUUID()}@example.test`, "ADMIN");
  const bidderId = await insertUser(`bidder-${randomUUID()}@example.test`, "BIDDER");
  const auctionId = randomUUID();
  const auctionCreationRequestId = randomUUID();
  const bidId = randomUUID();
  const commitmentClientRequestId = randomUUID();
  const revealClientRequestId = randomUUID();

  await client.query(
    `
      INSERT INTO "Auction" (
        "id",
        "creationRequestId",
        "title",
        "currency",
        "startTime",
        "revealTime",
        "endTime",
        "createdById",
        "updatedAt"
      )
      VALUES (
        $1,
        $2,
        'Verification Auction',
        'USD',
        NOW() + INTERVAL '1 hour',
        NOW() + INTERVAL '2 hours',
        NOW() + INTERVAL '3 hours',
        $3,
        NOW()
      )
    `,
    [auctionId, auctionCreationRequestId, adminId],
  );

  await client.query(
    `
      INSERT INTO "Bid" ("id", "auctionId", "bidderId", "updatedAt")
      VALUES ($1, $2, $3, NOW())
    `,
    [bidId, auctionId, bidderId],
  );

  await client.query(
    `
      INSERT INTO "BidCommitment" (
        "id",
        "bidId",
        "clientRequestId",
        "commitmentHash"
      )
      VALUES ($1, $2, $3, $4)
    `,
    [randomUUID(), bidId, commitmentClientRequestId, "a".repeat(64)],
  );

  await client.query(
    `
      INSERT INTO "BidRevealAttempt" (
        "id",
        "bidId",
        "clientRequestId",
        "amountCents",
        "secret",
        "validationStatus"
      )
      VALUES ($1, $2, $3, $4, $5, 'VALID')
    `,
    [randomUUID(), bidId, revealClientRequestId, 10000n, "verified-secret"],
  );

  for (const tableName of requiredTables) {
    const result = await client.query(`SELECT COUNT(*)::int AS count FROM "${tableName}"`);
    assert(result.rows[0].count > 0, `${tableName} insert was not visible`);
  }

  console.log("ok - all five auction-domain tables accept valid rows");

  const existingBidderEmail = (
    await client.query('SELECT "email" FROM "User" WHERE "id" = $1', [bidderId])
  ).rows[0].email;

  await expectPgError(
    "duplicate normalized emails fail",
    { codes: ["23505"], constraints: ["User_email_key"] },
    () =>
      client.query(
        `
          INSERT INTO "User" ("id", "email", "passwordHash", "role", "updatedAt")
          VALUES ($1, $2, $3, 'BIDDER', NOW())
        `,
        [randomUUID(), existingBidderEmail, "verified-password-hash"],
      ),
  );

  await expectPgError(
    "uppercase emails fail normalization",
    { codes: ["23514"], constraints: ["User_email_normalized_check"] },
    () =>
      client.query(
        `
          INSERT INTO "User" ("id", "email", "passwordHash", "role", "updatedAt")
          VALUES ($1, 'Uppercase@example.test', $2, 'BIDDER', NOW())
        `,
        [randomUUID(), "verified-password-hash"],
      ),
  );

  await expectPgError(
    "invalid auction timing fails",
    { codes: ["23514"], constraints: ["Auction_time_order_check"] },
    () =>
      client.query(
        `
          INSERT INTO "Auction" (
            "id",
            "creationRequestId",
            "title",
            "currency",
            "startTime",
            "revealTime",
            "endTime",
            "createdById",
            "updatedAt"
          )
          VALUES (
            $1,
            $2,
            'Invalid Timing Auction',
            'USD',
            NOW() + INTERVAL '3 hours',
            NOW() + INTERVAL '2 hours',
            NOW() + INTERVAL '1 hour',
            $3,
            NOW()
          )
        `,
        [randomUUID(), randomUUID(), adminId],
      ),
  );

  await expectPgError(
    "duplicate auction creation requests fail",
    { codes: ["23505"], constraints: ["Auction_creationRequestId_key"] },
    () =>
      client.query(
        `
          INSERT INTO "Auction" (
            "id",
            "creationRequestId",
            "title",
            "currency",
            "startTime",
            "revealTime",
            "endTime",
            "createdById",
            "updatedAt"
          )
          VALUES (
            $1,
            $2,
            'Duplicate Request Auction',
            'USD',
            NOW() + INTERVAL '1 hour',
            NOW() + INTERVAL '2 hours',
            NOW() + INTERVAL '3 hours',
            $3,
            NOW()
          )
        `,
        [randomUUID(), auctionCreationRequestId, adminId],
      ),
  );

  await expectPgError(
    "duplicate bidder-auction bids fail",
    { codes: ["23505"], constraints: ["Bid_auctionId_bidderId_key"] },
    () =>
      client.query(
        `
          INSERT INTO "Bid" ("id", "auctionId", "bidderId", "updatedAt")
          VALUES ($1, $2, $3, NOW())
        `,
        [randomUUID(), auctionId, bidderId],
      ),
  );

  await expectPgError(
    "zero-cent reveal amounts fail",
    { codes: ["23514"], constraints: ["BidRevealAttempt_amount_positive_check"] },
    () =>
      client.query(
        `
          INSERT INTO "BidRevealAttempt" (
            "id",
            "bidId",
            "clientRequestId",
            "amountCents",
            "secret"
          )
          VALUES ($1, $2, $3, 0, 'verified-secret')
        `,
        [randomUUID(), bidId, randomUUID()],
      ),
  );

  await expectPgError(
    "invalid commitment hashes fail",
    { codes: ["23514"], constraints: ["BidCommitment_hash_format_check"] },
    () =>
      client.query(
        `
          INSERT INTO "BidCommitment" (
            "id",
            "bidId",
            "clientRequestId",
            "commitmentHash",
            "isCurrent",
            "replacedAt"
          )
          VALUES ($1, $2, $3, 'NOT_A_SHA_256_HASH', FALSE, NOW())
        `,
        [randomUUID(), bidId, randomUUID()],
      ),
  );

  await expectPgError(
    "duplicate commitment client request identifiers fail",
    { codes: ["23505"], constraints: ["BidCommitment_clientRequestId_key"] },
    () =>
      client.query(
        `
          INSERT INTO "BidCommitment" (
            "id",
            "bidId",
            "clientRequestId",
            "commitmentHash",
            "isCurrent",
            "replacedAt"
          )
          VALUES ($1, $2, $3, $4, FALSE, NOW())
        `,
        [randomUUID(), bidId, commitmentClientRequestId, "b".repeat(64)],
      ),
  );

  await expectPgError(
    "duplicate reveal client request identifiers fail",
    { codes: ["23505"], constraints: ["BidRevealAttempt_clientRequestId_key"] },
    () =>
      client.query(
        `
          INSERT INTO "BidRevealAttempt" (
            "id",
            "bidId",
            "clientRequestId",
            "amountCents",
            "secret"
          )
          VALUES ($1, $2, $3, 12500, 'verified-secret')
        `,
        [randomUUID(), bidId, revealClientRequestId],
      ),
  );

  await expectPgError(
    "two current commitments fail",
    { codes: ["23505"], constraints: ["BidCommitment_one_current_per_bid"] },
    () =>
      client.query(
        `
          INSERT INTO "BidCommitment" (
            "id",
            "bidId",
            "clientRequestId",
            "commitmentHash"
          )
          VALUES ($1, $2, $3, $4)
        `,
        [randomUUID(), bidId, randomUUID(), "c".repeat(64)],
      ),
  );

  await expectPgError(
    "two valid reveals fail",
    { codes: ["23505"], constraints: ["BidRevealAttempt_one_valid_per_bid"] },
    () =>
      client.query(
        `
          INSERT INTO "BidRevealAttempt" (
            "id",
            "bidId",
            "clientRequestId",
            "amountCents",
            "secret",
            "validationStatus"
          )
          VALUES ($1, $2, $3, 12500, 'verified-secret', 'VALID')
        `,
        [randomUUID(), bidId, randomUUID()],
      ),
  );

  await client.query('UPDATE "Bid" SET "status" = $1, "updatedAt" = NOW() WHERE "id" = $2', [
    "WON",
    bidId,
  ]);

  const secondBidderId = await insertUser(`second-bidder-${randomUUID()}@example.test`, "BIDDER");

  await expectPgError(
    "two auction winners fail",
    { codes: ["23505"], constraints: ["Bid_one_winner_per_auction"] },
    () =>
      client.query(
        `
          INSERT INTO "Bid" ("id", "auctionId", "bidderId", "status", "updatedAt")
          VALUES ($1, $2, $3, 'WON', NOW())
        `,
        [randomUUID(), auctionId, secondBidderId],
      ),
  );
}

try {
  await main();
  console.log("ok - schema verification transaction completed");
} finally {
  if (transactionStarted) {
    await client.query("ROLLBACK");
    console.log("ok - schema verification transaction rolled back");
  }

  await client.end();
}
