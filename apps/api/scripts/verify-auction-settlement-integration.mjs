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
const port = 3107;
const startupTimeoutMs = 10000;
const runId = randomUUID();
const jwtSecret = randomBytes(32).toString("base64url");
const issuer = "auction-settlement-integration";
const audience = "auction-settlement-integration-web";
const adminEmail = `settlement-admin-${runId}@example.test`;
const bidderEmail = `settlement-bidder-${runId}@example.test`;
const secondBidderEmail = `settlement-bidder-2-${runId}@example.test`;
const adminPassword = "AuctionAdminTest123!";
const bidderPassword = "AuctionBidderTest123!";
const secondBidderPassword = "AuctionBidderTwo123!";
const createdAuctionIds = new Set();
const createdUserEmails = [adminEmail, bidderEmail, secondBidderEmail];
const capturedResponses = [];

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
  const result = { path: pathname, statusCode: response.status, body };
  capturedResponses.push(result);
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

async function settle(token, auctionId, body) {
  return requestJson(`/api/admin/auctions/${auctionId}/settle`, {
    method: "POST",
    headers: token ? authHeaders(token) : {},
    body: JSON.stringify(body),
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
  const adminId = randomUUID();
  const bidderId = randomUUID();
  const secondBidderId = randomUUID();
  await client.query(
    `
      INSERT INTO "User" ("id", "email", "passwordHash", "role", "status", "updatedAt")
      VALUES
      ($1, $2, $3, 'ADMIN', 'ACTIVE', NOW()),
      ($4, $5, $6, 'BIDDER', 'ACTIVE', NOW()),
      ($7, $8, $9, 'BIDDER', 'ACTIVE', NOW())
    `,
    [
      adminId,
      adminEmail,
      await argon2.hash(adminPassword, { type: argon2.argon2id }),
      bidderId,
      bidderEmail,
      await argon2.hash(bidderPassword, { type: argon2.argon2id }),
      secondBidderId,
      secondBidderEmail,
      await argon2.hash(secondBidderPassword, { type: argon2.argon2id }),
    ],
  );
  return { adminId, bidderId, secondBidderId };
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

async function insertAuction(client, adminId, overrides = {}) {
  const now = overrides.now ?? (await databaseNow(client));
  const id = overrides.id ?? randomUUID();
  createdAuctionIds.add(id);
  const status = overrides.status ?? "PUBLISHED";
  const startTime = overrides.startTime ?? minutesFrom(now, -180);
  const revealTime = overrides.revealTime ?? minutesFrom(now, -120);
  const endTime = overrides.endTime ?? minutesFrom(now, -60);
  await client.query(
    `
      INSERT INTO "Auction" (
        "id", "creationRequestId", "title", "description", "currency",
        "startTime", "revealTime", "endTime", "status", "createdById",
        "settlementRequestId", "settledAt", "cancelledAt", "cancellationReason",
        "version", "updatedAt"
      )
      VALUES ($1, $2, $3, 'Temporary settlement integration record', 'USD',
        $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW())
    `,
    [
      id,
      randomUUID(),
      overrides.title ?? `Settlement Test ${runId}`,
      startTime,
      revealTime,
      endTime,
      status,
      adminId,
      overrides.settlementRequestId ?? null,
      overrides.settledAt ?? null,
      overrides.cancelledAt ?? null,
      overrides.cancellationReason ?? null,
      overrides.version ?? 0,
    ],
  );
  return id;
}

async function insertBid(client, auctionId, bidderId, overrides = {}) {
  const id = overrides.id ?? randomUUID();
  const status = overrides.status ?? "COMMITTED";
  const version = overrides.version ?? (status === "REVEALED" ? 2 : 1);
  await client.query(
    `
      INSERT INTO "Bid" ("id", "auctionId", "bidderId", "status", "version", "updatedAt")
      VALUES ($1, $2, $3, $4, $5, NOW())
    `,
    [id, auctionId, bidderId, status, version],
  );
  if (overrides.withCommitment !== false) {
    await client.query(
      `
        INSERT INTO "BidCommitment" (
          "id", "bidId", "clientRequestId", "commitmentHash", "protocolVersion",
          "isCurrent", "committedAt"
        )
        VALUES ($1, $2, $3, $4, 1, TRUE, $5)
      `,
      [
        overrides.commitmentId ?? randomUUID(),
        id,
        randomUUID(),
        overrides.commitmentHash ?? randomBytes(32).toString("hex"),
        overrides.committedAt ?? new Date(),
      ],
    );
  }
  if (overrides.validAmountCents !== undefined) {
    await client.query(
      `
        INSERT INTO "BidRevealAttempt" (
          "id", "bidId", "clientRequestId", "amountCents", "secret",
          "validationStatus", "invalidReason", "submittedAt"
        )
        VALUES ($1, $2, $3, $4, $5, 'VALID', NULL, $6)
      `,
      [
        overrides.revealId ?? randomUUID(),
        id,
        randomUUID(),
        BigInt(overrides.validAmountCents),
        overrides.secret ?? `secret-${randomUUID()}`,
        overrides.submittedAt ?? new Date(),
      ],
    );
  }
  if (overrides.invalidAttempt) {
    await client.query(
      `
        INSERT INTO "BidRevealAttempt" (
          "id", "bidId", "clientRequestId", "amountCents", "secret",
          "validationStatus", "invalidReason", "submittedAt"
        )
        VALUES ($1, $2, $3, 1, $4, 'INVALID', 'COMMITMENT_MISMATCH', NOW())
      `,
      [randomUUID(), id, randomUUID(), overrides.invalidSecret ?? `bad-${randomUUID()}`],
    );
  }
  return id;
}

async function getAuctionState(client, auctionId) {
  const auction = await client.query(
    'SELECT "id", "status", "version", "settlementRequestId", "settledAt" FROM "Auction" WHERE "id" = $1',
    [auctionId],
  );
  const bids = await client.query(
    'SELECT "id", "status", "version" FROM "Bid" WHERE "auctionId" = $1 ORDER BY "id" ASC',
    [auctionId],
  );
  return { auction: auction.rows[0] ?? null, bids: bids.rows };
}

async function countRevealAttempts(client, auctionId) {
  const result = await client.query(
    'SELECT COUNT(*)::int AS "count" FROM "BidRevealAttempt" WHERE "bidId" IN (SELECT "id" FROM "Bid" WHERE "auctionId" = $1)',
    [auctionId],
  );
  return result.rows[0].count;
}

function expectNoSensitiveFields(value, context, forbidden = []) {
  const serialized = JSON.stringify(value);
  const lower = serialized.toLowerCase();
  for (const field of [
    "secret",
    "commitmentHash",
    "clientRequestId",
    "settlementRequestId",
    "creationRequestId",
    "cancellationRequestId",
    "passwordHash",
    "invalidReason",
    "revealAttempt",
    ...forbidden,
  ]) {
    assert(!lower.includes(field.toLowerCase()), `${context} exposed ${field}`);
  }
}

async function verifyAuthorization(adminToken, bidderToken, adminId) {
  const auctionId = await insertAuction(globalClient, adminId);
  const body = { settlementRequestId: randomUUID(), expectedVersion: 0 };
  const missing = await settle(null, auctionId, body);
  assert(missing.statusCode === 401, "missing auth expected 401");
  const invalid = await requestJson(`/api/admin/auctions/${auctionId}/settle`, {
    method: "POST",
    headers: { Authorization: "Bearer invalid-token", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  assert(invalid.statusCode === 401, "invalid auth expected 401");
  const bidder = await settle(bidderToken, auctionId, body);
  assert(bidder.statusCode === 403, "bidder settle expected 403");
  const admin = await settle(adminToken, auctionId, body);
  assert(admin.statusCode === 200, "admin settle expected 200");
  console.log("ok - auction settlement authorization passed");
}

async function verifyValidation(client, adminToken, adminId) {
  const auctionId = await insertAuction(client, adminId);
  const valid = { settlementRequestId: randomUUID(), expectedVersion: 0 };
  const invalidBodies = [
    { ...valid, settlementRequestId: undefined },
    { ...valid, settlementRequestId: "not-a-uuid" },
    { ...valid, expectedVersion: undefined },
    { ...valid, expectedVersion: -1 },
    { ...valid, expectedVersion: 1.5 },
    { ...valid, winnerBidId: randomUUID() },
    { ...valid, amountCents: "12500" },
    { ...valid, settledAt: new Date().toISOString() },
    { ...valid, unknown: true },
  ];
  for (const body of invalidBodies) {
    const cleanBody = Object.fromEntries(
      Object.entries(body).filter(([, value]) => value !== undefined),
    );
    const response = await settle(adminToken, auctionId, cleanBody);
    assert(response.statusCode === 400, `invalid settlement body expected 400, got ${response.statusCode}`);
  }
  const state = await getAuctionState(client, auctionId);
  assert(state.auction.status === "PUBLISHED", "invalid requests changed auction");
  console.log("ok - auction settlement validation passed");
}

async function verifyTiming(client, adminToken, adminId) {
  const now = await databaseNow(client);
  const draft = await insertAuction(client, adminId, { status: "DRAFT", now });
  const active = await insertAuction(client, adminId, {
    now,
    startTime: minutesFrom(now, -60),
    revealTime: minutesFrom(now, -30),
    endTime: minutesFrom(now, 60),
  });
  const ended = await insertAuction(client, adminId, { now });
  const cancelled = await insertAuction(client, adminId, {
    status: "CANCELLED",
    now,
    cancelledAt: now,
    cancellationReason: "Temporary cancellation",
  });
  const settled = await insertAuction(client, adminId, {
    status: "SETTLED",
    now,
    settlementRequestId: randomUUID(),
    settledAt: now,
  });
  const cases = [
    [draft, 409],
    [active, 409],
    [ended, 200],
    [cancelled, 409],
    [settled, 409],
    [randomUUID(), 404],
  ];
  for (const [auctionId, expectedStatus] of cases) {
    const response = await settle(adminToken, auctionId, {
      settlementRequestId: randomUUID(),
      expectedVersion: 0,
    });
    assert(response.statusCode === expectedStatus, `timing case expected ${expectedStatus}, got ${response.statusCode}`);
  }
  console.log("ok - auction settlement timing passed");
}

async function verifyHighestBid(client, adminToken, adminId, bidderIds) {
  const auctionId = await insertAuction(client, adminId);
  const bid10000 = await insertBid(client, auctionId, bidderIds[0], {
    status: "REVEALED",
    validAmountCents: "10000",
  });
  const bid12500 = await insertBid(client, auctionId, bidderIds[1], {
    status: "REVEALED",
    validAmountCents: "12500",
  });
  const bid11000 = await insertBid(client, auctionId, bidderIds[2], {
    status: "REVEALED",
    validAmountCents: "11000",
  });
  const response = await settle(adminToken, auctionId, {
    settlementRequestId: randomUUID(),
    expectedVersion: 0,
  });
  assert(response.statusCode === 200, "highest-bid settlement expected 200");
  assert(response.body.summary.winner.bidId === bid12500, "highest bid did not win");
  assert(response.body.summary.winner.amountCents === "12500", "winner amount mismatch");
  expectNoSensitiveFields(response.body, "highest-bid response", ["10000", "11000"]);
  const state = await getAuctionState(client, auctionId);
  assert(state.auction.status === "SETTLED", "auction did not settle");
  assert(state.auction.version === 1, "auction version did not increment once");
  const statusById = Object.fromEntries(state.bids.map((bid) => [bid.id, bid.status]));
  assert(statusById[bid12500] === "WON", "winner status mismatch");
  assert(statusById[bid10000] === "LOST" && statusById[bid11000] === "LOST", "loser status mismatch");
  assert(state.bids.every((bid) => bid.version === 3), "changed bid versions did not increment once");
  console.log("ok - highest-bid settlement passed");
}

async function verifyTieBreakers(client, adminToken, adminId, bidderIds) {
  const now = await databaseNow(client);
  const timeAuction = await insertAuction(client, adminId, { now });
  const later = await insertBid(client, timeAuction, bidderIds[0], {
    status: "REVEALED",
    validAmountCents: "12500",
    committedAt: minutesFrom(now, -30),
  });
  const earlier = await insertBid(client, timeAuction, bidderIds[1], {
    status: "REVEALED",
    validAmountCents: "12500",
    committedAt: minutesFrom(now, -60),
  });
  const timeResponse = await settle(adminToken, timeAuction, {
    settlementRequestId: randomUUID(),
    expectedVersion: 0,
  });
  assert(timeResponse.statusCode === 200, "commitment-time tie expected 200");
  assert(timeResponse.body.summary.winner.bidId === earlier, "earlier commitment did not win tie");
  assert(timeResponse.body.summary.winner.bidId !== later, "later commitment won tie");

  const idAuction = await insertAuction(client, adminId, { now });
  const largerId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const smallerId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  await insertBid(client, idAuction, bidderIds[0], {
    id: largerId,
    status: "REVEALED",
    validAmountCents: "12500",
    committedAt: now,
  });
  await insertBid(client, idAuction, bidderIds[1], {
    id: smallerId,
    status: "REVEALED",
    validAmountCents: "12500",
    committedAt: now,
  });
  const idResponse = await settle(adminToken, idAuction, {
    settlementRequestId: randomUUID(),
    expectedVersion: 0,
  });
  assert(idResponse.statusCode === 200, "bid-id tie expected 200");
  assert(idResponse.body.summary.winner.bidId === smallerId, "lexicographically smaller bid did not win tie");
  console.log("ok - settlement tie-breakers passed");
}

async function verifyUnrevealedAndNoWinner(client, adminToken, adminId, bidderIds) {
  const mixedAuction = await insertAuction(client, adminId);
  const revealed = await insertBid(client, mixedAuction, bidderIds[0], {
    status: "REVEALED",
    validAmountCents: "12500",
    secret: "stored-secret-value",
  });
  const committed = await insertBid(client, mixedAuction, bidderIds[1], {
    status: "COMMITTED",
  });
  const invalidOnly = await insertBid(client, mixedAuction, bidderIds[2], {
    status: "COMMITTED",
    invalidAttempt: true,
    invalidSecret: "unchanged-invalid-secret",
  });
  const response = await settle(adminToken, mixedAuction, {
    settlementRequestId: randomUUID(),
    expectedVersion: 0,
  });
  assert(response.statusCode === 200, "mixed settlement expected 200");
  assert(response.body.summary.winner.bidId === revealed, "mixed winner mismatch");
  expectNoSensitiveFields(response.body, "mixed settlement response", ["unchanged-invalid-secret"]);
  const state = await getAuctionState(client, mixedAuction);
  const statusById = Object.fromEntries(state.bids.map((bid) => [bid.id, bid.status]));
  assert(statusById[revealed] === "WON", "mixed revealed bid did not win");
  assert(statusById[committed] === "INVALID", "unrevealed committed bid not invalidated");
  assert(statusById[invalidOnly] === "INVALID", "invalid-attempt bid not invalidated");
  assert((await countRevealAttempts(client, mixedAuction)) === 2, "reveal attempt history changed unexpectedly");

  const noWinnerAuction = await insertAuction(client, adminId);
  await insertBid(client, noWinnerAuction, bidderIds[0], { status: "COMMITTED" });
  await insertBid(client, noWinnerAuction, bidderIds[1], {
    status: "COMMITTED",
    invalidAttempt: true,
  });
  const noWinner = await settle(adminToken, noWinnerAuction, {
    settlementRequestId: randomUUID(),
    expectedVersion: 0,
  });
  assert(noWinner.statusCode === 200, "no-winner settlement expected 200");
  assert(noWinner.body.summary.winner === null, "no-winner should have null winner");
  assert(noWinner.body.summary.validRevealCount === 0, "no-winner valid count mismatch");
  assert(noWinner.body.summary.invalidBidCount === 2, "no-winner invalid count mismatch");

  const emptyAuction = await insertAuction(client, adminId);
  const empty = await settle(adminToken, emptyAuction, {
    settlementRequestId: randomUUID(),
    expectedVersion: 0,
  });
  assert(empty.statusCode === 200, "empty settlement expected 200");
  assert(empty.body.summary.winner === null, "empty winner should be null");
  assert(empty.body.summary.totalBidCount === 0, "empty total count mismatch");
  assert(empty.body.summary.validRevealCount === 0, "empty valid count mismatch");
  assert(empty.body.summary.invalidBidCount === 0, "empty invalid count mismatch");
  console.log("ok - unrevealed and no-winner settlements passed");
}

async function verifyRetriesAndConflicts(client, adminToken, adminId, bidderIds) {
  const retryAuction = await insertAuction(client, adminId);
  await insertBid(client, retryAuction, bidderIds[0], {
    status: "REVEALED",
    validAmountCents: "12500",
  });
  const requestId = randomUUID();
  const first = await settle(adminToken, retryAuction, {
    settlementRequestId: requestId,
    expectedVersion: 0,
  });
  assert(first.statusCode === 200, "retry setup expected 200");
  const before = await getAuctionState(client, retryAuction);
  const retry = await settle(adminToken, retryAuction, {
    settlementRequestId: requestId,
    expectedVersion: 999,
  });
  assert(retry.statusCode === 200, "exact retry expected 200");
  assert(retry.body.summary.winner.bidId === first.body.summary.winner.bidId, "retry winner changed");
  const after = await getAuctionState(client, retryAuction);
  assert(after.auction.version === before.auction.version, "retry changed auction version");
  assert(JSON.stringify(after.bids) === JSON.stringify(before.bids), "retry changed bids");

  const conflictAuction = await insertAuction(client, adminId);
  const conflict = await settle(adminToken, conflictAuction, {
    settlementRequestId: requestId,
    expectedVersion: 0,
  });
  assert(conflict.statusCode === 409, "settlement request id conflict expected 409");
  assert((await getAuctionState(client, conflictAuction)).auction.status === "PUBLISHED", "conflict changed second auction");

  const staleAuction = await insertAuction(client, adminId);
  await insertBid(client, staleAuction, bidderIds[0], {
    status: "REVEALED",
    validAmountCents: "12500",
  });
  const stale = await settle(adminToken, staleAuction, {
    settlementRequestId: randomUUID(),
    expectedVersion: 99,
  });
  assert(stale.statusCode === 409, "stale settlement expected 409");
  assert((await getAuctionState(client, staleAuction)).auction.status === "PUBLISHED", "stale request changed auction");
  console.log("ok - settlement retries and conflicts passed");
}

async function verifyConcurrency(client, adminToken, adminId, bidderIds) {
  const sameAuction = await insertAuction(client, adminId);
  await insertBid(client, sameAuction, bidderIds[0], {
    status: "REVEALED",
    validAmountCents: "12500",
  });
  await insertBid(client, sameAuction, bidderIds[1], {
    status: "COMMITTED",
  });
  const sameRequestId = randomUUID();
  const [sameA, sameB] = await Promise.all([
    settle(adminToken, sameAuction, { settlementRequestId: sameRequestId, expectedVersion: 0 }),
    settle(adminToken, sameAuction, { settlementRequestId: sameRequestId, expectedVersion: 0 }),
  ]);
  assert(
    sameA.statusCode === 200 && [200, 409].includes(sameB.statusCode),
    `same-id race unexpected statuses ${sameA.statusCode}, ${sameB.statusCode}`,
  );
  const sameState = await getAuctionState(client, sameAuction);
  assert(sameState.auction.version === 1, "same-id race auction version mismatch");
  assert(sameState.bids.every((bid) => bid.version === (bid.status === "WON" ? 3 : 2)), "same-id race bid versions mismatch");

  const differentAuction = await insertAuction(client, adminId);
  await insertBid(client, differentAuction, bidderIds[0], {
    status: "REVEALED",
    validAmountCents: "12500",
  });
  await insertBid(client, differentAuction, bidderIds[1], {
    status: "COMMITTED",
  });
  const [differentA, differentB] = await Promise.all([
    settle(adminToken, differentAuction, { settlementRequestId: randomUUID(), expectedVersion: 0 }),
    settle(adminToken, differentAuction, { settlementRequestId: randomUUID(), expectedVersion: 0 }),
  ]);
  const statuses = [differentA.statusCode, differentB.statusCode].sort();
  assert(JSON.stringify(statuses) === JSON.stringify([200, 409]), "different-id race status mismatch");
  const differentState = await getAuctionState(client, differentAuction);
  assert(differentState.auction.version === 1, "different-id race auction version mismatch");
  console.log("ok - concurrent settlement passed");
}

async function verifyCorruptionProtection(client, adminToken, adminId, bidderIds) {
  const cases = [
    async (auctionId) => {
      await insertBid(client, auctionId, bidderIds[0], {
        status: "REVEALED",
      });
    },
    async (auctionId) => {
      await insertBid(client, auctionId, bidderIds[0], {
        status: "COMMITTED",
        validAmountCents: "12500",
      });
    },
    async (auctionId) => {
      await insertBid(client, auctionId, bidderIds[0], {
        status: "COMMITTED",
        withCommitment: false,
      });
    },
    async (auctionId) => {
      await insertBid(client, auctionId, bidderIds[0], {
        status: "WON",
      });
    },
    async (auctionId) => {
      await insertBid(client, auctionId, bidderIds[0], {
        status: "LOST",
      });
    },
  ];
  for (const setup of cases) {
    const auctionId = await insertAuction(client, adminId);
    await setup(auctionId);
    const before = await getAuctionState(client, auctionId);
    const response = await settle(adminToken, auctionId, {
      settlementRequestId: randomUUID(),
      expectedVersion: 0,
    });
    assert(response.statusCode === 500, "corrupt settlement expected 500");
    assert(
      response.body.message === "Auction data is inconsistent" ||
        response.body.message === "Internal server error",
      "corrupt response exposed internals",
    );
    const after = await getAuctionState(client, auctionId);
    assert(JSON.stringify(after) === JSON.stringify(before), "corrupt settlement changed data");
  }
  console.log("ok - settlement corruption protection passed");
}

function verifyResponseSafety(getOutput) {
  const serializedResponses = JSON.stringify(
    capturedResponses
      .filter((response) => response.path.includes("/settle"))
      .filter((response) => response.statusCode === 200)
      .map((response) => response.body),
  );
  for (const forbidden of [
    "secret",
    "commitmentHash",
    "clientRequestId",
    "settlementRequestId",
    "creationRequestId",
    "cancellationRequestId",
    "passwordHash",
    "invalidReason",
    "revealAttempt",
  ]) {
    assert(!serializedResponses.toLowerCase().includes(forbidden.toLowerCase()), `responses exposed ${forbidden}`);
    assert(!getOutput().toLowerCase().includes(forbidden.toLowerCase()), `application output exposed ${forbidden}`);
  }
  assert(!/eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/.test(serializedResponses), "JWT appeared in responses");
  console.log("ok - settlement response safety passed");
}

let globalClient;

async function main() {
  assert(databaseUrl, "DATABASE_URL is required");
  let child = null;
  let getOutput = () => "";
  let databaseConnected = false;
  const client = new Client({ connectionString: databaseUrl });
  globalClient = client;

  try {
    await runCommand("npm", ["run", "build", "--workspace", "@auction/commitment"], rootDirectory);
    console.log("ok - shared commitment package builds");
    await runCommand("npm", ["run", "verify", "--workspace", "@auction/commitment"], rootDirectory);
    console.log("ok - shared commitment protocol verifies");
    await runCommand("npm", ["run", "build"], apiDirectory);
    console.log("ok - NestJS application builds");

    await client.connect();
    databaseConnected = true;
    await client.query("SELECT 1");
    console.log("ok - PostgreSQL is reachable");

    const { adminId, bidderId, secondBidderId } = await createTestUsers(client);
    const thirdBidderId = randomUUID();
    await client.query(
      'INSERT INTO "User" ("id", "email", "passwordHash", "role", "status", "updatedAt") VALUES ($1, $2, $3, $4, $5, NOW())',
      [
        thirdBidderId,
        `settlement-bidder-3-${runId}@example.test`,
        await argon2.hash("AuctionBidderThree123!", { type: argon2.argon2id }),
        "BIDDER",
        "ACTIVE",
      ],
    );
    createdUserEmails.push(`settlement-bidder-3-${runId}@example.test`);

    child = spawn(process.execPath, ["dist/main.js"], {
      cwd: apiDirectory,
      env: createEnvironment(),
      stdio: ["ignore", "pipe", "pipe"],
    });
    getOutput = createOutputBuffer(child);
    await waitForStartup(child, getOutput);

    const adminLogin = await login(adminEmail, adminPassword);
    assert(adminLogin.statusCode === 201, "temporary administrator login failed");
    const bidderLogin = await login(bidderEmail, bidderPassword);
    assert(bidderLogin.statusCode === 201, "temporary bidder login failed");
    const adminToken = adminLogin.body.accessToken;
    const bidderToken = bidderLogin.body.accessToken;
    const bidderIds = [bidderId, secondBidderId, thirdBidderId];

    await verifyAuthorization(adminToken, bidderToken, adminId);
    await verifyValidation(client, adminToken, adminId);
    await verifyTiming(client, adminToken, adminId);
    await verifyHighestBid(client, adminToken, adminId, bidderIds);
    await verifyTieBreakers(client, adminToken, adminId, bidderIds);
    await verifyUnrevealedAndNoWinner(client, adminToken, adminId, bidderIds);
    await verifyRetriesAndConflicts(client, adminToken, adminId, bidderIds);
    await verifyConcurrency(client, adminToken, adminId, bidderIds);
    await verifyCorruptionProtection(client, adminToken, adminId, bidderIds);
    verifyResponseSafety(getOutput);

    console.log("ok - auction settlement integration verification passed");
  } finally {
    if (child) {
      await terminateChild(child, getOutput);
    }
    if (databaseConnected) {
      try {
        await cleanup(client);
      } finally {
        await client.end();
      }
    }
  }
}

main().catch((error) => {
  console.error(sanitizeOutput(error instanceof Error ? error.stack ?? error.message : String(error)));
  process.exitCode = 1;
});
