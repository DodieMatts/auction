import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import argon2 from "argon2";
import pg from "pg";

const { Client } = pg;

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const apiDirectory = resolve(scriptDirectory, "..");
const rootDirectory = resolve(apiDirectory, "../..");
const envPath = resolve(apiDirectory, ".env");
const host = "127.0.0.1";
const port = 3108;
const startupTimeoutMs = 10000;
const runId = randomUUID();
const jwtSecret = randomBytes(32).toString("base64url");
const issuer = "auction-results-integration";
const audience = "auction-results-integration-web";
const adminEmail = `results-admin-${runId}@example.test`;
const winnerEmail = `results-winner-${runId}@example.test`;
const loserEmail = `results-loser-${runId}@example.test`;
const invalidEmail = `results-invalid-${runId}@example.test`;
const nonparticipantEmail = `results-nonparticipant-${runId}@example.test`;
const adminPassword = "AuctionAdminTest123!";
const bidderPassword = "AuctionBidderTest123!";
const createdAuctionIds = new Set();
const createdUserEmails = [
  adminEmail,
  winnerEmail,
  loserEmail,
  invalidEmail,
  nonparticipantEmail,
];
const resultResponses = [];
const leakValues = new Set();

function parseEnvFile(path) {
  if (!existsSync(path)) return {};

  return Object.fromEntries(
    readFileSync(path, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
      .map((line) => {
        const separatorIndex = line.indexOf("=");
        const key = line.slice(0, separatorIndex).trim();
        let value = line.slice(separatorIndex + 1).trim();
        if (
          (value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))
        ) {
          value = value.slice(1, -1);
        }
        return [key, value];
      }),
  );
}

const fileEnv = parseEnvFile(envPath);
const databaseUrl = process.env.DATABASE_URL ?? fileEnv.DATABASE_URL;

function sanitizeOutput(output) {
  let sanitized = output;
  for (const value of [databaseUrl, jwtSecret]) {
    if (value) sanitized = sanitized.split(value).join("[REDACTED]");
  }
  return sanitized
    .replaceAll(/postgres(?:ql)?:\/\/[^\s'"]+/g, "[REDACTED_DATABASE_URL]")
    .replaceAll(/eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g, "[REDACTED_TOKEN]");
}

function createEnvironment(overrides = {}) {
  return {
    ...process.env,
    ...fileEnv,
    NODE_ENV: "test",
    HOST: host,
    PORT: String(port),
    JWT_ACCESS_SECRET: jwtSecret,
    JWT_ACCESS_TTL_SECONDS: "900",
    JWT_ISSUER: issuer,
    JWT_AUDIENCE: audience,
    ...overrides,
  };
}

function createOutputBuffer(child) {
  const chunks = [];
  child.stdout.on("data", (chunk) => chunks.push(chunk));
  child.stderr.on("data", (chunk) => chunks.push(chunk));
  return () => sanitizeOutput(Buffer.concat(chunks).toString("utf8"));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function wait(ms) {
  return new Promise((resolveWait) => setTimeout(resolveWait, ms));
}

async function runCommand(command, args, cwd = apiDirectory) {
  return new Promise((resolveCommand, rejectCommand) => {
    const child = spawn(command, args, {
      cwd,
      env: createEnvironment(),
      stdio: ["ignore", "pipe", "pipe"],
    });
    const getOutput = createOutputBuffer(child);
    child.once("error", rejectCommand);
    child.once("close", (code, signal) => {
      if (code === 0) {
        resolveCommand();
        return;
      }
      rejectCommand(
        new Error(
          `${command} ${args.join(" ")} failed with code ${code ?? "null"} signal ${signal ?? "null"}\n${getOutput()}`,
        ),
      );
    });
  });
}

async function requestJson(pathname, options = {}) {
  const response = await fetch(`http://${host}:${port}${pathname}`, {
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });
  let body = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  const result = { statusCode: response.status, headers: response.headers, body };
  if (pathname.includes("/results")) resultResponses.push(result);
  return result;
}

async function waitForStartup(child, getOutput) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < startupTimeoutMs) {
    if (child.exitCode !== null) {
      throw new Error(`API exited before startup completed\n${getOutput()}`);
    }
    try {
      const response = await requestJson("/api/health/live");
      if (response.statusCode === 200) return;
    } catch {
      await wait(150);
    }
  }
  throw new Error(`API did not start within ${startupTimeoutMs}ms\n${getOutput()}`);
}

async function terminateChild(child, getOutput) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  const result = await Promise.race([once(child, "close"), wait(5000)]);
  if (!Array.isArray(result)) {
    child.kill("SIGKILL");
    throw new Error(`API did not terminate after SIGTERM\n${getOutput()}`);
  }
}

function authHeaders(token) {
  return { Authorization: `Bearer ${token}` };
}

async function login(email, password) {
  return requestJson("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

async function bidderResults(token, auctionId) {
  return requestJson(`/api/auctions/${auctionId}/results`, {
    method: "GET",
    headers: token ? authHeaders(token) : {},
  });
}

async function adminResults(token, auctionId) {
  return requestJson(`/api/admin/auctions/${auctionId}/results`, {
    method: "GET",
    headers: token ? authHeaders(token) : {},
  });
}

async function cleanup(client) {
  const ids = [...createdAuctionIds];
  if (ids.length > 0) {
    await client.query(
      'DELETE FROM "BidRevealAttempt" WHERE "bidId" IN (SELECT "id" FROM "Bid" WHERE "auctionId" = ANY($1))',
      [ids],
    );
    await client.query(
      'DELETE FROM "BidCommitment" WHERE "bidId" IN (SELECT "id" FROM "Bid" WHERE "auctionId" = ANY($1))',
      [ids],
    );
    await client.query('DELETE FROM "Bid" WHERE "auctionId" = ANY($1)', [ids]);
    await client.query('DELETE FROM "Auction" WHERE "id" = ANY($1)', [ids]);
  }
  await client.query('DELETE FROM "User" WHERE "email" = ANY($1)', [
    createdUserEmails,
  ]);
}

async function createTestUsers(client) {
  await cleanup(client);
  const users = {
    adminId: randomUUID(),
    winnerId: randomUUID(),
    loserId: randomUUID(),
    invalidId: randomUUID(),
    nonparticipantId: randomUUID(),
  };
  const passwordHash = await argon2.hash(bidderPassword, { type: argon2.argon2id });
  await client.query(
    `
      INSERT INTO "User" ("id", "email", "passwordHash", "role", "status", "updatedAt")
      VALUES
      ($1, $2, $3, 'ADMIN', 'ACTIVE', NOW()),
      ($4, $5, $6, 'BIDDER', 'ACTIVE', NOW()),
      ($7, $8, $9, 'BIDDER', 'ACTIVE', NOW()),
      ($10, $11, $12, 'BIDDER', 'ACTIVE', NOW()),
      ($13, $14, $15, 'BIDDER', 'ACTIVE', NOW())
    `,
    [
      users.adminId,
      adminEmail,
      await argon2.hash(adminPassword, { type: argon2.argon2id }),
      users.winnerId,
      winnerEmail,
      passwordHash,
      users.loserId,
      loserEmail,
      passwordHash,
      users.invalidId,
      invalidEmail,
      passwordHash,
      users.nonparticipantId,
      nonparticipantEmail,
      passwordHash,
    ],
  );
  return users;
}

async function databaseNow(client) {
  const result = await client.query('SELECT CURRENT_TIMESTAMP AS "now"');
  const now = result.rows[0]?.now;
  assert(now instanceof Date, "database timestamp was not a Date");
  return now;
}

function minutesFrom(anchor, minutes) {
  return new Date(anchor.getTime() + minutes * 60_000);
}

async function createAuction(client, adminId, status, options = {}) {
  const now = options.now ?? (await databaseNow(client));
  const auctionId = options.id ?? randomUUID();
  createdAuctionIds.add(auctionId);
  const settledAt =
    options.settledAt ??
    (status === "SETTLED" ? minutesFrom(now, -1) : null);
  const cancelledAt =
    options.cancelledAt ??
    (status === "CANCELLED" ? minutesFrom(now, -1) : null);

  await client.query(
    `
      INSERT INTO "Auction"
      (
        "id",
        "creationRequestId",
        "title",
        "description",
        "currency",
        "startTime",
        "revealTime",
        "endTime",
        "status",
        "createdById",
        "settledAt",
        "cancelledAt",
        "cancellationReason",
        "version",
        "updatedAt"
      )
      VALUES ($1, $2, $3, $4, 'USD', $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW())
    `,
    [
      auctionId,
      randomUUID(),
      options.title ?? `Results Test ${runId} ${auctionId}`,
      options.description ?? "Safe results fixture",
      options.startTime ?? minutesFrom(now, -180),
      options.revealTime ?? minutesFrom(now, -120),
      options.endTime ?? minutesFrom(now, -60),
      status,
      adminId,
      settledAt,
      cancelledAt,
      status === "CANCELLED" ? "Cancelled fixture" : null,
      options.version ?? 1,
    ],
  );

  return auctionId;
}

function randomHash() {
  return randomBytes(32).toString("hex");
}

function rememberLeak(value) {
  leakValues.add(String(value));
  return value;
}

async function createBid(client, input) {
  const bidId = input.bidId ?? randomUUID();
  const commitmentId = randomUUID();
  const commitmentHash = rememberLeak(input.commitmentHash ?? randomHash());
  const secret = input.secret ?? rememberLeak(`secret-${randomUUID()}`);
  await client.query(
    `
      INSERT INTO "Bid" ("id", "auctionId", "bidderId", "status", "version", "updatedAt")
      VALUES ($1, $2, $3, $4, $5, NOW())
    `,
    [bidId, input.auctionId, input.bidderId, input.status, input.version ?? 3],
  );

  if (input.withCurrentCommitment !== false) {
    await client.query(
      `
        INSERT INTO "BidCommitment"
        ("id", "bidId", "clientRequestId", "commitmentHash", "protocolVersion", "isCurrent", "committedAt")
        VALUES ($1, $2, $3, $4, 1, TRUE, $5)
      `,
      [
        commitmentId,
        bidId,
        randomUUID(),
        commitmentHash,
        input.committedAt ?? minutesFrom(await databaseNow(client), -90),
      ],
    );
  }

  if (input.validAmountCents !== undefined) {
    await client.query(
      `
        INSERT INTO "BidRevealAttempt"
        ("id", "bidId", "clientRequestId", "amountCents", "secret", "validationStatus", "invalidReason", "submittedAt")
        VALUES ($1, $2, $3, $4, $5, 'VALID', NULL, $6)
      `,
      [
        randomUUID(),
        bidId,
        randomUUID(),
        BigInt(input.validAmountCents),
        secret,
        input.submittedAt ?? minutesFrom(await databaseNow(client), -30),
      ],
    );
  }

  if (input.invalidAttempt === true) {
    await client.query(
      `
        INSERT INTO "BidRevealAttempt"
        ("id", "bidId", "clientRequestId", "amountCents", "secret", "validationStatus", "invalidReason", "submittedAt")
        VALUES ($1, $2, $3, 1, $4, 'INVALID', 'COMMITMENT_MISMATCH', $5)
      `,
      [
        randomUUID(),
        bidId,
        randomUUID(),
        secret,
        input.submittedAt ?? minutesFrom(await databaseNow(client), -30),
      ],
    );
  }

  return bidId;
}

async function createSettledResultFixture(client, users) {
  const auctionId = await createAuction(client, users.adminId, "SETTLED");
  const winnerAmount = "12500";
  const loserAmount = "11000";
  const hiddenLosingAmount = "10432";
  const invalidSecret = rememberLeak(`invalid-secret-${runId}`);

  await createBid(client, {
    auctionId,
    bidderId: users.winnerId,
    status: "WON",
    validAmountCents: winnerAmount,
  });
  await createBid(client, {
    auctionId,
    bidderId: users.loserId,
    status: "LOST",
    validAmountCents: loserAmount,
  });
  await createBid(client, {
    auctionId,
    bidderId: users.invalidId,
    status: "INVALID",
    invalidAttempt: true,
    secret: invalidSecret,
  });
  return { auctionId, winnerAmount, loserAmount, hiddenLosingAmount };
}

function assertNoKeys(value, forbiddenKeys, context) {
  const serialized = JSON.stringify(value).toLowerCase();
  for (const key of forbiddenKeys) {
    assert(!serialized.includes(key.toLowerCase()), `${context} leaked ${key}`);
  }
}

async function rowVersions(client, auctionId) {
  const auction = await client.query(
    'SELECT "version" FROM "Auction" WHERE "id" = $1',
    [auctionId],
  );
  const bids = await client.query(
    'SELECT "id", "version", "status" FROM "Bid" WHERE "auctionId" = $1 ORDER BY "id"',
    [auctionId],
  );
  return {
    auctionVersion: auction.rows[0]?.version,
    bids: bids.rows.map((row) => ({ ...row })),
  };
}

async function testAuthorization(adminToken, winnerToken, auctionId) {
  let response = await bidderResults(null, auctionId);
  assert(response.statusCode === 401, "bidder results missing auth should return 401");

  response = await bidderResults(adminToken, auctionId);
  assert(response.statusCode === 403, "admin token should not access bidder results");

  response = await bidderResults(winnerToken, auctionId);
  assert(response.statusCode === 200, "bidder token should access bidder results");

  response = await adminResults(null, auctionId);
  assert(response.statusCode === 401, "admin results missing auth should return 401");

  response = await adminResults(winnerToken, auctionId);
  assert(response.statusCode === 403, "bidder token should not access admin results");

  response = await adminResults(adminToken, auctionId);
  assert(response.statusCode === 200, "admin token should access admin results");

  console.log("ok - auction results authorization passed");
}

async function testAvailability(client, users, adminToken, winnerToken) {
  const now = await databaseNow(client);
  const draftId = await createAuction(client, users.adminId, "DRAFT", {
    now,
    startTime: minutesFrom(now, 60),
    revealTime: minutesFrom(now, 120),
    endTime: minutesFrom(now, 180),
  });
  const publishedId = await createAuction(client, users.adminId, "PUBLISHED", { now });
  const cancelledId = await createAuction(client, users.adminId, "CANCELLED", {
    now,
    startTime: minutesFrom(now, 60),
    revealTime: minutesFrom(now, 120),
    endTime: minutesFrom(now, 180),
  });
  const settledId = await createAuction(client, users.adminId, "SETTLED", { now });
  const unknownId = randomUUID();

  assert((await bidderResults(winnerToken, draftId)).statusCode === 404, "bidder draft result should be hidden");
  assert((await bidderResults(winnerToken, cancelledId)).statusCode === 404, "bidder cancelled result should be hidden");
  assert((await bidderResults(winnerToken, publishedId)).statusCode === 409, "bidder published result should be unavailable");
  assert((await bidderResults(winnerToken, settledId)).statusCode === 200, "bidder settled result should be available");
  assert((await bidderResults(winnerToken, unknownId)).statusCode === 404, "unknown bidder result should be 404");

  assert((await adminResults(adminToken, draftId)).statusCode === 409, "admin draft result should be unavailable");
  assert((await adminResults(adminToken, cancelledId)).statusCode === 409, "admin cancelled result should be unavailable");
  assert((await adminResults(adminToken, publishedId)).statusCode === 409, "admin published result should be unavailable");
  assert((await adminResults(adminToken, settledId)).statusCode === 200, "admin settled result should be available");
  assert((await adminResults(adminToken, unknownId)).statusCode === 404, "unknown admin result should be 404");

  console.log("ok - auction results availability passed");
}

async function testRoleSpecificResults(
  adminToken,
  winnerToken,
  loserToken,
  invalidToken,
  nonparticipantToken,
  fixture,
) {
  const winnerResponse = await bidderResults(winnerToken, fixture.auctionId);
  assert(winnerResponse.statusCode === 200, "winner bidder results should return 200");
  assert(winnerResponse.body.result.yourOutcome.status === "WON", "winner outcome should be WON");
  assert(winnerResponse.body.result.yourOutcome.amountCents === fixture.winnerAmount, "winner should see own amount");
  assert(winnerResponse.body.result.winner.amountCents === fixture.winnerAmount, "winner should see winning amount");
  assert(!JSON.stringify(winnerResponse.body).includes(fixture.loserAmount), "winner response leaked losing amount");
  assertNoKeys(winnerResponse.body, ["bidderId", "email", "bidId"], "winner bidder result");

  const loserResponse = await bidderResults(loserToken, fixture.auctionId);
  assert(loserResponse.statusCode === 200, "loser bidder results should return 200");
  assert(loserResponse.body.result.yourOutcome.status === "LOST", "loser outcome should be LOST");
  assert(loserResponse.body.result.yourOutcome.amountCents === fixture.loserAmount, "loser should see own amount");
  assert(loserResponse.body.result.winner.amountCents === fixture.winnerAmount, "loser should see winning amount");
  assert(!JSON.stringify(loserResponse.body).includes(winnerEmail), "bidder result leaked winner email");

  const invalidResponse = await bidderResults(invalidToken, fixture.auctionId);
  assert(invalidResponse.statusCode === 200, "invalid bidder results should return 200");
  assert(invalidResponse.body.result.yourOutcome.status === "INVALID", "invalid outcome should be INVALID");
  assert(invalidResponse.body.result.yourOutcome.amountCents === null, "invalid outcome should not expose amount");
  assert(!JSON.stringify(invalidResponse.body).includes(fixture.loserAmount), "invalid bidder response leaked losing amount");
  assertNoKeys(invalidResponse.body, ["invalidReason", "revealAttempt"], "invalid bidder result");

  const nonparticipantResponse = await bidderResults(nonparticipantToken, fixture.auctionId);
  assert(nonparticipantResponse.statusCode === 200, "nonparticipant results should return 200");
  assert(
    nonparticipantResponse.body.result.yourOutcome.status === "NOT_PARTICIPATED",
    "nonparticipant outcome should be NOT_PARTICIPATED",
  );
  assert(nonparticipantResponse.body.result.yourOutcome.amountCents === null, "nonparticipant amount should be null");
  assert(!JSON.stringify(nonparticipantResponse.body).includes(fixture.loserAmount), "nonparticipant response leaked losing amount");

  const adminResponse = await adminResults(adminToken, fixture.auctionId);
  assert(adminResponse.statusCode === 200, "admin results should return 200");
  assert(adminResponse.body.summary.winner.bidder.id, "admin result should include winner bidder id");
  assert(adminResponse.body.summary.winner.bidder.email === winnerEmail, "admin result should include winner email");
  assert(adminResponse.body.summary.winner.amountCents === fixture.winnerAmount, "admin result should include winning amount");
  assert(adminResponse.body.summary.totalBidCount === 3, "admin total count should be 3");
  assert(adminResponse.body.summary.validRevealCount === 2, "admin valid reveal count should be 2");
  assert(adminResponse.body.summary.invalidBidCount === 1, "admin invalid count should be 1");
  assert(!JSON.stringify(adminResponse.body).includes(fixture.loserAmount), "admin result leaked losing amount");
  assertNoKeys(adminResponse.body, ["bidId", loserEmail, invalidEmail], "admin result");

  console.log("ok - role-specific auction results passed");
}

async function testNoWinnerAndNoBid(client, users, winnerToken) {
  const noWinnerId = await createAuction(client, users.adminId, "SETTLED");
  await createBid(client, {
    auctionId: noWinnerId,
    bidderId: users.invalidId,
    status: "INVALID",
    invalidAttempt: true,
  });
  const noWinnerResponse = await bidderResults(winnerToken, noWinnerId);
  assert(noWinnerResponse.statusCode === 200, "no-winner result should return 200");
  assert(noWinnerResponse.body.result.winner === null, "no-winner result should have null winner");
  assert(noWinnerResponse.body.result.validRevealCount === 0, "no-winner valid count should be 0");
  assert(noWinnerResponse.body.result.invalidBidCount === 1, "no-winner invalid count should match");

  const noBidId = await createAuction(client, users.adminId, "SETTLED");
  const noBidResponse = await bidderResults(winnerToken, noBidId);
  assert(noBidResponse.statusCode === 200, "no-bid result should return 200");
  assert(noBidResponse.body.result.winner === null, "no-bid winner should be null");
  assert(noBidResponse.body.result.totalBidCount === 0, "no-bid total count should be 0");
  assert(noBidResponse.body.result.validRevealCount === 0, "no-bid valid count should be 0");
  assert(noBidResponse.body.result.invalidBidCount === 0, "no-bid invalid count should be 0");
  assert(noBidResponse.body.result.yourOutcome.status === "NOT_PARTICIPATED", "no-bid outcome should be nonparticipant");

  console.log("ok - no-winner and no-bid auction results passed");
}

async function testRepeatedReadsAreSideEffectFree(client, winnerToken, auctionId) {
  const before = await rowVersions(client, auctionId);
  const first = await bidderResults(winnerToken, auctionId);
  const second = await bidderResults(winnerToken, auctionId);
  const after = await rowVersions(client, auctionId);
  assert(first.statusCode === 200 && second.statusCode === 200, "repeated reads should succeed");
  const { serverTime: firstServerTime, ...firstStableBody } = first.body;
  const { serverTime: secondServerTime, ...secondStableBody } = second.body;
  assert(Date.parse(firstServerTime) > 0, "first result server time should parse");
  assert(Date.parse(secondServerTime) > 0, "second result server time should parse");
  assert(JSON.stringify(firstStableBody) === JSON.stringify(secondStableBody), "repeated result payloads should remain stable");
  assert(JSON.stringify(before) === JSON.stringify(after), "result reads changed database versions or statuses");

  console.log("ok - auction result repeated reads are side-effect free");
}

async function testPrivacy(fixture, getOutput) {
  const bidderForbidden = [
    "bidderId",
    "email",
    "bidId",
    "secret",
    "commitmentHash",
    "clientRequestId",
    "settlementRequestId",
    "creationRequestId",
    "cancellationRequestId",
    "passwordHash",
    "invalidReason",
    "revealAttempt",
  ];
  const adminForbidden = [
    "secret",
    "commitmentHash",
    "clientRequestId",
    "settlementRequestId",
    "creationRequestId",
    "cancellationRequestId",
    "passwordHash",
    "invalidReason",
    "losingAmount",
  ];

  for (const response of resultResponses) {
    if (response.statusCode !== 200) continue;
    const serialized = JSON.stringify(response.body);
    if ("result" in response.body) {
      for (const forbidden of bidderForbidden) {
        assert(!serialized.toLowerCase().includes(forbidden.toLowerCase()), `bidder response leaked ${forbidden}`);
      }
    }
    if ("summary" in response.body) {
      for (const forbidden of adminForbidden) {
        assert(!serialized.toLowerCase().includes(forbidden.toLowerCase()), `admin response leaked ${forbidden}`);
      }
    }
  }

  const output = getOutput();
  for (const value of leakValues) {
    assert(!output.includes(String(value)), "application output leaked a sensitive fixture value");
  }
  assert(!output.includes(fixture.loserAmount), "application output leaked losing amount");

  console.log("ok - auction result privacy passed");
}

async function testCorruption(client, users, winnerToken) {
  const cases = [
    {
      name: "COMMITTED bid after settlement",
      create: async (auctionId) =>
        createBid(client, {
          auctionId,
          bidderId: users.winnerId,
          status: "COMMITTED",
        }),
    },
    {
      name: "REVEALED bid after settlement",
      create: async (auctionId) =>
        createBid(client, {
          auctionId,
          bidderId: users.winnerId,
          status: "REVEALED",
          validAmountCents: "12000",
        }),
    },
    {
      name: "WON bid without valid reveal",
      create: async (auctionId) =>
        createBid(client, {
          auctionId,
          bidderId: users.winnerId,
          status: "WON",
        }),
    },
    {
      name: "LOST bid without valid reveal",
      create: async (auctionId) =>
        createBid(client, {
          auctionId,
          bidderId: users.winnerId,
          status: "LOST",
        }),
    },
    {
      name: "INVALID bid with valid reveal",
      create: async (auctionId) =>
        createBid(client, {
          auctionId,
          bidderId: users.winnerId,
          status: "INVALID",
          validAmountCents: "12000",
        }),
    },
    {
      name: "Bid without current commitment",
      create: async (auctionId) =>
        createBid(client, {
          auctionId,
          bidderId: users.winnerId,
          status: "INVALID",
          withCurrentCommitment: false,
        }),
    },
  ];

  for (const testCase of cases) {
    const auctionId = await createAuction(client, users.adminId, "SETTLED");
    await testCase.create(auctionId);
    const response = await bidderResults(winnerToken, auctionId);
    assert(response.statusCode === 500, `${testCase.name} should fail with 500`);
    const serialized = JSON.stringify(response.body);
    assert(serialized.includes("Auction result data is inconsistent"), `${testCase.name} should return safe message`);
    assert(!serialized.includes(auctionId), `${testCase.name} leaked auction id`);
  }

  console.log("ok - auction result corruption protection passed");
}

async function main() {
  if (!databaseUrl) throw new Error("DATABASE_URL is required");

  await runCommand("npm", ["run", "build", "--workspace", "@auction/commitment"], rootDirectory);
  console.log("ok - shared commitment package builds");
  await runCommand("npm", ["run", "build"]);
  console.log("ok - NestJS application builds");

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  let api = null;
  let getOutput = () => "";

  try {
    await client.query("SELECT 1");
    console.log("ok - PostgreSQL is reachable");
    const users = await createTestUsers(client);
    const fixture = await createSettledResultFixture(client, users);

    api = spawn(process.execPath, ["dist/main.js"], {
      cwd: apiDirectory,
      env: createEnvironment(),
      stdio: ["ignore", "pipe", "pipe"],
    });
    getOutput = createOutputBuffer(api);
    await waitForStartup(api, getOutput);

    const adminLogin = await login(adminEmail, adminPassword);
    const winnerLogin = await login(winnerEmail, bidderPassword);
    const loserLogin = await login(loserEmail, bidderPassword);
    const invalidLogin = await login(invalidEmail, bidderPassword);
    const nonparticipantLogin = await login(nonparticipantEmail, bidderPassword);
    assert(adminLogin.statusCode === 201, "admin login failed");
    assert(winnerLogin.statusCode === 201, "winner login failed");
    assert(loserLogin.statusCode === 201, "loser login failed");
    assert(invalidLogin.statusCode === 201, "invalid bidder login failed");
    assert(nonparticipantLogin.statusCode === 201, "nonparticipant login failed");

    const adminToken = adminLogin.body.accessToken;
    const winnerToken = winnerLogin.body.accessToken;
    const loserToken = loserLogin.body.accessToken;
    const invalidToken = invalidLogin.body.accessToken;
    const nonparticipantToken = nonparticipantLogin.body.accessToken;

    await testAuthorization(adminToken, winnerToken, fixture.auctionId);
    await testAvailability(client, users, adminToken, winnerToken);
    await testRoleSpecificResults(
      adminToken,
      winnerToken,
      loserToken,
      invalidToken,
      nonparticipantToken,
      fixture,
    );
    await testNoWinnerAndNoBid(client, users, winnerToken);
    await testRepeatedReadsAreSideEffectFree(client, winnerToken, fixture.auctionId);
    await testCorruption(client, users, winnerToken);
    await testPrivacy(fixture, getOutput);

    console.log("ok - auction results integration verification passed");
  } finally {
    if (api) await terminateChild(api, getOutput);
    await cleanup(client);
    await client.end();
  }
}

main().catch((error) => {
  console.error(sanitizeOutput(error instanceof Error ? error.stack ?? error.message : String(error)));
  process.exitCode = 1;
});
