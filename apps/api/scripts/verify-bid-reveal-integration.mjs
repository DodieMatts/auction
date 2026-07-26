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
const port = 3106;
const startupTimeoutMs = 10000;
const runId = randomUUID();
const jwtSecret = randomBytes(32).toString("base64url");
const issuer = "bid-reveal-integration";
const audience = "bid-reveal-integration-web";
const adminEmail = `reveal-admin-${runId}@example.test`;
const bidderEmail = `reveal-bidder-${runId}@example.test`;
const secondBidderEmail = `reveal-bidder-2-${runId}@example.test`;
const adminPassword = "AuctionAdminTest123!";
const bidderPassword = "AuctionBidderTest123!";
const secondBidderPassword = "AuctionBidderTwo123!";
const createdAuctionIds = new Set();
const createdUserEmails = [adminEmail, bidderEmail, secondBidderEmail];
const capturedResponses = [];
let computeBidCommitmentV1;
let generateBidSecretV1;
let commitmentProtocolVersion = 1;

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
  const result = { path: pathname, statusCode: response.status, headers: response.headers, body };
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

async function postCommitment(token, auctionId, body) {
  return requestJson(`/api/auctions/${auctionId}/commitments`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify(body),
  });
}

async function postReveal(token, auctionId, body) {
  return requestJson(`/api/auctions/${auctionId}/reveals`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify(body),
  });
}

async function getRevealStatus(token, auctionId) {
  return requestJson(`/api/auctions/${auctionId}/reveal-status`, {
    method: "GET",
    headers: authHeaders(token),
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
  const startTime = overrides.startTime ?? minutesFrom(now, -120);
  const revealTime = overrides.revealTime ?? minutesFrom(now, -60);
  const endTime = overrides.endTime ?? minutesFrom(now, 60);

  await client.query(
    `
      INSERT INTO "Auction" (
        "id", "creationRequestId", "title", "description", "currency",
        "startTime", "revealTime", "endTime", "status", "createdById",
        "settledAt", "cancelledAt", "cancellationReason", "updatedAt"
      )
      VALUES ($1, $2, $3, 'Temporary bid reveal integration record', 'USD',
        $4, $5, $6, $7, $8, $9, $10, $11, NOW())
    `,
    [
      id,
      randomUUID(),
      overrides.title ?? `Bid Reveal Test ${runId}`,
      startTime,
      revealTime,
      endTime,
      status,
      adminId,
      overrides.settledAt ?? null,
      overrides.cancelledAt ?? null,
      overrides.cancellationReason ?? null,
    ],
  );
  return id;
}

async function createPhaseAuctions(client, adminId) {
  const now = await databaseNow(client);
  return {
    draft: await insertAuction(client, adminId, {
      now,
      status: "DRAFT",
      startTime: minutesFrom(now, -120),
      revealTime: minutesFrom(now, -60),
      endTime: minutesFrom(now, 60),
      title: `Bid Reveal Test ${runId} Draft`,
    }),
    scheduled: await insertAuction(client, adminId, {
      now,
      startTime: minutesFrom(now, 60),
      revealTime: minutesFrom(now, 120),
      endTime: minutesFrom(now, 180),
      title: `Bid Reveal Test ${runId} Scheduled`,
    }),
    commit: await insertAuction(client, adminId, {
      now,
      startTime: minutesFrom(now, -60),
      revealTime: minutesFrom(now, 60),
      endTime: minutesFrom(now, 120),
      title: `Bid Reveal Test ${runId} Commit`,
    }),
    reveal: await insertAuction(client, adminId, {
      now,
      startTime: minutesFrom(now, -120),
      revealTime: minutesFrom(now, -60),
      endTime: minutesFrom(now, 60),
      title: `Bid Reveal Test ${runId} Reveal`,
    }),
    ended: await insertAuction(client, adminId, {
      now,
      startTime: minutesFrom(now, -180),
      revealTime: minutesFrom(now, -120),
      endTime: minutesFrom(now, -60),
      title: `Bid Reveal Test ${runId} Ended`,
    }),
    cancelled: await insertAuction(client, adminId, {
      now,
      status: "CANCELLED",
      startTime: minutesFrom(now, -120),
      revealTime: minutesFrom(now, -60),
      endTime: minutesFrom(now, 60),
      cancelledAt: now,
      cancellationReason: "Temporary cancellation",
      title: `Bid Reveal Test ${runId} Cancelled`,
    }),
    settled: await insertAuction(client, adminId, {
      now,
      status: "SETTLED",
      startTime: minutesFrom(now, -180),
      revealTime: minutesFrom(now, -120),
      endTime: minutesFrom(now, -60),
      settledAt: now,
      title: `Bid Reveal Test ${runId} Settled`,
    }),
  };
}

async function moveAuctionToReveal(client, auctionId) {
  const now = await databaseNow(client);
  await client.query(
    `
      UPDATE "Auction"
      SET "status" = 'PUBLISHED',
          "startTime" = $2,
          "revealTime" = $3,
          "endTime" = $4,
          "settledAt" = NULL,
          "cancelledAt" = NULL,
          "cancellationReason" = NULL,
          "updatedAt" = NOW()
      WHERE "id" = $1
    `,
    [auctionId, minutesFrom(now, -120), minutesFrom(now, -60), minutesFrom(now, 60)],
  );
}

async function moveAuctionToEnded(client, auctionId) {
  const now = await databaseNow(client);
  await client.query(
    `
      UPDATE "Auction"
      SET "startTime" = $2, "revealTime" = $3, "endTime" = $4, "updatedAt" = NOW()
      WHERE "id" = $1
    `,
    [auctionId, minutesFrom(now, -180), minutesFrom(now, -120), minutesFrom(now, -60)],
  );
}

async function commitmentBody(auctionId, bidderId, amountCents, secret, overrides = {}) {
  return {
    clientRequestId: overrides.clientRequestId ?? randomUUID(),
    commitmentHash:
      overrides.commitmentHash ??
      (await computeBidCommitmentV1({
        auctionId,
        bidderId,
        currency: "USD",
        amountCents,
        secret,
      })),
    protocolVersion: overrides.protocolVersion ?? commitmentProtocolVersion,
    ...(overrides.expectedBidVersion === undefined
      ? { expectedBidVersion: 0 }
      : { expectedBidVersion: overrides.expectedBidVersion }),
  };
}

async function createCommittedBid(client, token, auctionId, bidderId, amountCents = "12500") {
  const now = await databaseNow(client);
  await client.query(
    `
      UPDATE "Auction"
      SET "status" = 'PUBLISHED',
          "startTime" = $2,
          "revealTime" = $3,
          "endTime" = $4,
          "settledAt" = NULL,
          "cancelledAt" = NULL,
          "cancellationReason" = NULL,
          "updatedAt" = NOW()
      WHERE "id" = $1
    `,
    [auctionId, minutesFrom(now, -60), minutesFrom(now, 60), minutesFrom(now, 120)],
  );
  const secret = generateBidSecretV1();
  const body = await commitmentBody(auctionId, bidderId, amountCents, secret);
  const response = await postCommitment(token, auctionId, body);
  assert(response.statusCode === 201, `commitment setup expected 201, got ${response.statusCode}`);
  return {
    amountCents,
    secret,
    commitmentHash: body.commitmentHash,
    bidId: response.body.bid.id,
    bidVersion: response.body.bid.version,
    commitmentId: response.body.commitment.id,
  };
}

async function getBidState(client, auctionId, bidderId) {
  const bid = await client.query(
    'SELECT "id", "status", "version" FROM "Bid" WHERE "auctionId" = $1 AND "bidderId" = $2',
    [auctionId, bidderId],
  );
  if (bid.rowCount === 0) return null;
  const attempts = await client.query(
    `
      SELECT "id", "amountCents", "secret", "validationStatus", "invalidReason", "submittedAt"
      FROM "BidRevealAttempt"
      WHERE "bidId" = $1
      ORDER BY "submittedAt" ASC, "id" ASC
    `,
    [bid.rows[0].id],
  );
  return { bid: bid.rows[0], attempts: attempts.rows };
}

function expectResponseClean(value, context, extraForbidden = []) {
  const serialized = JSON.stringify(value);
  const lower = serialized.toLowerCase();
  for (const term of [
    "secret",
    "commitmentHash",
    "computed",
    "expected",
    "clientRequestId",
    ...extraForbidden,
  ]) {
    assert(!lower.includes(term.toLowerCase()), `${context} exposed ${term}`);
  }
}

async function verifyValidation(client, token, auctionId) {
  const valid = {
    clientRequestId: randomUUID(),
    amountCents: "12500",
    secret: generateBidSecretV1(),
    expectedBidVersion: 1,
  };
  const invalidBodies = [
    { ...valid, clientRequestId: undefined },
    { ...valid, clientRequestId: "not-a-uuid" },
    { ...valid, amountCents: undefined },
    { ...valid, amountCents: 12500 },
    { ...valid, amountCents: "0" },
    { ...valid, amountCents: "01" },
    { ...valid, amountCents: "-100" },
    { ...valid, amountCents: "12.50" },
    { ...valid, amountCents: "1e3" },
    { ...valid, amountCents: "9223372036854775808" },
    { ...valid, secret: undefined },
    { ...valid, secret: valid.secret.slice(0, 42) },
    { ...valid, secret: `${valid.secret.slice(0, 42)}=` },
    { ...valid, secret: `${valid.secret.slice(0, 42)}!` },
    { ...valid, expectedBidVersion: undefined },
    { ...valid, expectedBidVersion: -1 },
    { ...valid, expectedBidVersion: 1.5 },
    { ...valid, price: "125.00" },
    { ...valid, commitmentHash: "a".repeat(64) },
    { ...valid, protocolVersion: 1 },
    { ...valid, bidderId: randomUUID() },
    { ...valid, unknown: true },
  ];

  for (const body of invalidBodies) {
    const cleanBody = Object.fromEntries(
      Object.entries(body).filter(([, value]) => value !== undefined),
    );
    const response = await postReveal(token, auctionId, cleanBody);
    assert(response.statusCode === 400, `invalid reveal body expected 400, got ${response.statusCode}`);
  }

  const count = await client.query(
    'SELECT COUNT(*)::int AS "count" FROM "BidRevealAttempt" WHERE "bidId" IN (SELECT "id" FROM "Bid" WHERE "auctionId" = $1)',
    [auctionId],
  );
  assert(count.rows[0].count === 0, "invalid reveal bodies created attempts");
  console.log("ok - bid reveal validation passed");
}

async function verifyAuthorization(adminToken, bidderToken, auctionId, body) {
  const missingPost = await requestJson(`/api/auctions/${auctionId}/reveals`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  assert(missingPost.statusCode === 401, "missing reveal auth expected 401");
  const invalidPost = await requestJson(`/api/auctions/${auctionId}/reveals`, {
    method: "POST",
    headers: { Authorization: "Bearer invalid-token" },
    body: JSON.stringify(body),
  });
  assert(invalidPost.statusCode === 401, "invalid reveal auth expected 401");
  const adminPost = await postReveal(adminToken, auctionId, body);
  assert(adminPost.statusCode === 403, "admin reveal expected 403");

  const missingGet = await requestJson(`/api/auctions/${auctionId}/reveal-status`, {
    method: "GET",
  });
  assert(missingGet.statusCode === 401, "missing reveal-status auth expected 401");
  const invalidGet = await requestJson(`/api/auctions/${auctionId}/reveal-status`, {
    method: "GET",
    headers: { Authorization: "Bearer invalid-token" },
  });
  assert(invalidGet.statusCode === 401, "invalid reveal-status auth expected 401");
  const adminGet = await getRevealStatus(adminToken, auctionId);
  assert(adminGet.statusCode === 403, "admin reveal-status expected 403");
  const bidderGet = await getRevealStatus(bidderToken, auctionId);
  assert(bidderGet.statusCode === 200, "bidder reveal-status expected 200");
  console.log("ok - bid reveal authorization passed");
}

async function verifyTiming(client, bidderToken, bidderId, phaseAuctions) {
  const revealSetup = await createCommittedBid(client, bidderToken, phaseAuctions.reveal, bidderId);
  await moveAuctionToReveal(client, phaseAuctions.reveal);

  for (const [phase, auctionId] of Object.entries(phaseAuctions)) {
    const body =
      phase === "reveal"
        ? {
            clientRequestId: randomUUID(),
            amountCents: revealSetup.amountCents,
            secret: revealSetup.secret,
            expectedBidVersion: 1,
          }
        : {
            clientRequestId: randomUUID(),
            amountCents: "12500",
            secret: generateBidSecretV1(),
            expectedBidVersion: 1,
          };
    const response = await postReveal(bidderToken, auctionId, body);
    if (phase === "reveal") {
      assert(response.statusCode === 201, "reveal phase expected 201");
    } else if (phase === "draft" || phase === "cancelled") {
      assert(response.statusCode === 404, `${phase} expected 404`);
    } else {
      assert(response.statusCode === 409, `${phase} expected 409`);
      assert(
        response.body.message === "Auction is not accepting reveals",
        `${phase} conflict message mismatch`,
      );
    }
  }
  console.log("ok - bid reveal timing passed");
}

async function verifyValidReveal(client, bidderToken, auctionId, bidderId) {
  const setup = await createCommittedBid(client, bidderToken, auctionId, bidderId);
  await moveAuctionToReveal(client, auctionId);
  const body = {
    clientRequestId: randomUUID(),
    amountCents: setup.amountCents,
    secret: setup.secret,
    expectedBidVersion: 1,
  };
  const response = await postReveal(bidderToken, auctionId, body);
  assert(response.statusCode === 201, "valid reveal expected 201");
  assert(response.body.bid.status === "REVEALED", "valid reveal did not update bid status");
  assert(response.body.bid.version === 2, "valid reveal did not increment version");
  assert(response.body.reveal.validationStatus === "VALID", "valid reveal status mismatch");
  assert(response.body.reveal.amountCents === setup.amountCents, "valid reveal amount string mismatch");
  expectResponseClean(response.body, "valid reveal response", [setup.secret, setup.commitmentHash]);
  const state = await getBidState(client, auctionId, bidderId);
  assert(state.bid.status === "REVEALED", "stored valid bid status mismatch");
  assert(state.bid.version === 2, "stored valid bid version mismatch");
  assert(state.attempts.length === 1, "valid attempt count mismatch");
  assert(state.attempts[0].validationStatus === "VALID", "stored valid attempt mismatch");
  assert(state.attempts[0].invalidReason === null, "valid attempt has invalid reason");
  console.log("ok - valid bid reveal passed");
  return { setup, body, response };
}

async function verifyInvalidReveal(client, bidderToken, auctionId, bidderId, mode = "amount") {
  const setup = await createCommittedBid(client, bidderToken, auctionId, bidderId);
  await moveAuctionToReveal(client, auctionId);
  const body = {
    clientRequestId: randomUUID(),
    amountCents: mode === "amount" ? "12600" : setup.amountCents,
    secret: mode === "secret" ? generateBidSecretV1() : setup.secret,
    expectedBidVersion: 1,
  };
  const response = await postReveal(bidderToken, auctionId, body);
  assert(response.statusCode === 422, "invalid reveal expected 422");
  assert(response.body.details.validationStatus === "INVALID", "invalid status mismatch");
  assert(response.body.details.invalidReason === "COMMITMENT_MISMATCH", "invalid reason mismatch");
  expectResponseClean(response.body, "invalid reveal response", [
    body.secret,
    setup.commitmentHash,
    body.amountCents,
  ]);
  const state = await getBidState(client, auctionId, bidderId);
  assert(state.bid.status === "COMMITTED", "invalid reveal changed bid status");
  assert(state.bid.version === 1, "invalid reveal changed bid version");
  assert(state.attempts.length === 1, "invalid attempt count mismatch");
  assert(state.attempts[0].validationStatus === "INVALID", "stored invalid attempt mismatch");
  console.log(`ok - invalid ${mode} reveal passed`);
  return { setup, body, response };
}

async function verifyInvalidRetry(client, bidderToken, auctionId, bidderId) {
  const { body, response } = await verifyInvalidReveal(client, bidderToken, auctionId, bidderId);
  const retry = await postReveal(bidderToken, auctionId, body);
  assert(retry.statusCode === 422, "invalid retry expected 422");
  assert(
    retry.body.details.revealAttemptId === response.body.details.revealAttemptId,
    "invalid retry returned different attempt",
  );
  await moveAuctionToEnded(client, auctionId);
  const lateRetry = await postReveal(bidderToken, auctionId, body);
  assert(lateRetry.statusCode === 422, "late invalid retry expected 422");
  assert(
    lateRetry.body.details.revealAttemptId === response.body.details.revealAttemptId,
    "late invalid retry returned different attempt",
  );
  const state = await getBidState(client, auctionId, bidderId);
  assert(state.attempts.length === 1, "invalid retries created duplicates");
  console.log("ok - invalid reveal retry passed");
}

async function verifyValidRetry(client, bidderToken, auctionId, bidderId) {
  const { body, response } = await verifyValidReveal(client, bidderToken, auctionId, bidderId);
  const retry = await postReveal(bidderToken, auctionId, body);
  assert(retry.statusCode === 201, "valid retry expected 201");
  assert(retry.body.reveal.id === response.body.reveal.id, "valid retry returned different reveal");
  await moveAuctionToEnded(client, auctionId);
  const lateRetry = await postReveal(bidderToken, auctionId, body);
  assert(lateRetry.statusCode === 201, "late valid retry expected 201");
  assert(lateRetry.body.reveal.id === response.body.reveal.id, "late valid retry returned different reveal");
  const state = await getBidState(client, auctionId, bidderId);
  assert(state.attempts.length === 1, "valid retries created duplicates");
  assert(state.bid.version === 2, "valid retries changed version");
  console.log("ok - valid reveal retry passed");
}

async function verifyIdentifierConflicts(client, bidderToken, secondBidderToken, auctionId, otherAuctionId, bidderId) {
  const setup = await createCommittedBid(client, bidderToken, auctionId, bidderId);
  await moveAuctionToReveal(client, auctionId);
  const body = {
    clientRequestId: randomUUID(),
    amountCents: "12600",
    secret: setup.secret,
    expectedBidVersion: 1,
  };
  const first = await postReveal(bidderToken, auctionId, body);
  assert(first.statusCode === 422, "identifier setup expected invalid reveal");

  const changedAmount = await postReveal(bidderToken, auctionId, {
    ...body,
    amountCents: "12700",
  });
  assert(changedAmount.statusCode === 409, "changed amount identifier expected 409");
  const changedSecret = await postReveal(bidderToken, auctionId, {
    ...body,
    secret: generateBidSecretV1(),
  });
  assert(changedSecret.statusCode === 409, "changed secret identifier expected 409");
  const changedAuction = await postReveal(bidderToken, otherAuctionId, body);
  assert(changedAuction.statusCode === 409, "changed auction identifier expected 409");
  const changedBidder = await postReveal(secondBidderToken, auctionId, body);
  assert(changedBidder.statusCode === 409, "changed bidder identifier expected 409");
  const state = await getBidState(client, auctionId, bidderId);
  assert(state.attempts.length === 1, "identifier conflicts created attempts");
  console.log("ok - bid reveal identifier conflicts passed");
}

async function verifyStaleAndExistingValid(client, bidderToken, auctionId, bidderId) {
  const setup = await createCommittedBid(client, bidderToken, auctionId, bidderId);
  await moveAuctionToReveal(client, auctionId);
  const stale = await postReveal(bidderToken, auctionId, {
    clientRequestId: randomUUID(),
    amountCents: setup.amountCents,
    secret: setup.secret,
    expectedBidVersion: 0,
  });
  assert(stale.statusCode === 409, "stale reveal expected 409");
  let state = await getBidState(client, auctionId, bidderId);
  assert(state.attempts.length === 0, "stale reveal created attempt");
  assert(state.bid.status === "COMMITTED", "stale reveal changed status");
  const valid = await postReveal(bidderToken, auctionId, {
    clientRequestId: randomUUID(),
    amountCents: setup.amountCents,
    secret: setup.secret,
    expectedBidVersion: 1,
  });
  assert(valid.statusCode === 201, "existing valid setup expected 201");
  const anotherSame = await postReveal(bidderToken, auctionId, {
    clientRequestId: randomUUID(),
    amountCents: setup.amountCents,
    secret: setup.secret,
    expectedBidVersion: 1,
  });
  assert(anotherSame.statusCode === 409, "second valid identifier expected 409");
  const anotherDifferent = await postReveal(bidderToken, auctionId, {
    clientRequestId: randomUUID(),
    amountCents: "12600",
    secret: generateBidSecretV1(),
    expectedBidVersion: 1,
  });
  assert(anotherDifferent.statusCode === 409, "different reveal after valid expected 409");
  state = await getBidState(client, auctionId, bidderId);
  assert(state.attempts.length === 1, "existing valid conflicts created attempts");
  console.log("ok - bid reveal stale and existing-valid conflicts passed");
}

async function verifyConcurrentValid(client, bidderToken, auctionId, bidderId) {
  const setup = await createCommittedBid(client, bidderToken, auctionId, bidderId);
  await moveAuctionToReveal(client, auctionId);
  const [first, second] = await Promise.all([
    postReveal(bidderToken, auctionId, {
      clientRequestId: randomUUID(),
      amountCents: setup.amountCents,
      secret: setup.secret,
      expectedBidVersion: 1,
    }),
    postReveal(bidderToken, auctionId, {
      clientRequestId: randomUUID(),
      amountCents: setup.amountCents,
      secret: setup.secret,
      expectedBidVersion: 1,
    }),
  ]);
  const statuses = [first.statusCode, second.statusCode].sort();
  assert(JSON.stringify(statuses) === JSON.stringify([201, 409]), "concurrent valid status mismatch");
  const state = await getBidState(client, auctionId, bidderId);
  assert(state.bid.status === "REVEALED", "concurrent valid did not reveal bid");
  assert(state.bid.version === 2, "concurrent valid version mismatch");
  assert(state.attempts.filter((attempt) => attempt.validationStatus === "VALID").length === 1, "concurrent valid count mismatch");
  console.log("ok - concurrent valid reveal passed");
}

async function verifyConcurrentInvalid(client, bidderToken, auctionId, bidderId) {
  const setup = await createCommittedBid(client, bidderToken, auctionId, bidderId);
  await moveAuctionToReveal(client, auctionId);
  const [first, second] = await Promise.all([
    postReveal(bidderToken, auctionId, {
      clientRequestId: randomUUID(),
      amountCents: "12600",
      secret: setup.secret,
      expectedBidVersion: 1,
    }),
    postReveal(bidderToken, auctionId, {
      clientRequestId: randomUUID(),
      amountCents: "12700",
      secret: setup.secret,
      expectedBidVersion: 1,
    }),
  ]);
  assert(
    first.statusCode === 422 && second.statusCode === 422,
    `concurrent invalid expected two 422s, got ${first.statusCode} and ${second.statusCode}: ${JSON.stringify([first.body, second.body])}`,
  );
  const state = await getBidState(client, auctionId, bidderId);
  assert(state.bid.status === "COMMITTED", "concurrent invalid changed status");
  assert(state.bid.version === 1, "concurrent invalid changed version");
  assert(state.attempts.filter((attempt) => attempt.validationStatus === "INVALID").length === 2, "concurrent invalid count mismatch");
  assert(state.attempts.filter((attempt) => attempt.validationStatus === "VALID").length === 0, "concurrent invalid created valid attempt");
  console.log("ok - concurrent invalid reveal passed");
}

async function verifyValidInvalidRace(client, bidderToken, auctionId, bidderId) {
  const setup = await createCommittedBid(client, bidderToken, auctionId, bidderId);
  await moveAuctionToReveal(client, auctionId);
  const invalidPromise = postReveal(bidderToken, auctionId, {
    clientRequestId: randomUUID(),
    amountCents: "12600",
    secret: setup.secret,
    expectedBidVersion: 1,
  });
  const validPromise = postReveal(bidderToken, auctionId, {
    clientRequestId: randomUUID(),
    amountCents: setup.amountCents,
    secret: setup.secret,
    expectedBidVersion: 1,
  });
  const responses = await Promise.all([validPromise, invalidPromise]);
  const statuses = responses.map((response) => response.statusCode).sort();
  assert(JSON.stringify(statuses) === JSON.stringify([201, 422]), "valid/invalid race status mismatch");
  const state = await getBidState(client, auctionId, bidderId);
  assert(state.bid.status === "REVEALED", "valid/invalid race final status mismatch");
  assert(state.bid.version === 2, "valid/invalid race version mismatch");
  assert(state.attempts.filter((attempt) => attempt.validationStatus === "VALID").length === 1, "valid/invalid race valid count mismatch");
  assert(state.attempts.filter((attempt) => attempt.validationStatus === "INVALID").length >= 1, "valid/invalid race invalid missing");
  console.log("ok - valid and invalid reveal race passed");
}

async function verifyRevealStatus(client, bidderToken, secondBidderToken, auctionId, bidderId) {
  await moveAuctionToReveal(client, auctionId);
  const before = await getRevealStatus(bidderToken, auctionId);
  assert(before.statusCode === 200, "status before commitment expected 200");
  assert(before.body.bid === null, "status before commitment should have no bid");
  assert(before.body.canReveal === false, "status before commitment should not allow reveal");

  const setup = await createCommittedBid(client, bidderToken, auctionId, bidderId);
  await moveAuctionToReveal(client, auctionId);
  const afterCommit = await getRevealStatus(bidderToken, auctionId);
  assert(afterCommit.body.canReveal === true, "status after commitment should allow reveal");
  assert(afterCommit.body.bid.status === "COMMITTED", "status after commitment bid mismatch");

  const invalid = await postReveal(bidderToken, auctionId, {
    clientRequestId: randomUUID(),
    amountCents: "12600",
    secret: setup.secret,
    expectedBidVersion: 1,
  });
  assert(invalid.statusCode === 422, "status invalid setup expected 422");
  const afterInvalid = await getRevealStatus(bidderToken, auctionId);
  assert(afterInvalid.body.invalidAttemptCount === 1, "status invalid count mismatch");
  assert(afterInvalid.body.validReveal === null, "status invalid should not expose valid reveal");
  assert(afterInvalid.body.canReveal === true, "status after invalid should still allow reveal");

  const valid = await postReveal(bidderToken, auctionId, {
    clientRequestId: randomUUID(),
    amountCents: setup.amountCents,
    secret: setup.secret,
    expectedBidVersion: 1,
  });
  assert(valid.statusCode === 201, "status valid setup expected 201");
  const afterValid = await getRevealStatus(bidderToken, auctionId);
  assert(afterValid.body.canReveal === false, "status after valid should not allow reveal");
  assert(afterValid.body.bid.status === "REVEALED", "status after valid bid mismatch");
  assert(afterValid.body.validReveal.amountCents === setup.amountCents, "status valid amount mismatch");
  assert(afterValid.body.invalidAttemptCount === 1, "status after valid invalid count mismatch");
  expectResponseClean(afterValid.body, "reveal status response", [setup.secret, setup.commitmentHash]);

  const isolated = await getRevealStatus(secondBidderToken, auctionId);
  assert(isolated.statusCode === 200, "second bidder reveal status expected 200");
  assert(isolated.body.bid === null, "second bidder saw another bidder reveal state");
  console.log("ok - bid reveal status and isolation passed");
}

function verifyNoLeakage(getOutput, secretsAndHashes) {
  const revealResponses = capturedResponses.filter(
    (response) =>
      response.path.includes("/reveals") ||
      response.path.includes("/reveal-status"),
  );
  const serializedResponses = JSON.stringify(revealResponses);
  const appOutput = getOutput();
  for (const value of secretsAndHashes.filter(Boolean)) {
    assert(!serializedResponses.includes(value), "sensitive value appeared in serialized responses");
    assert(!appOutput.includes(value), "sensitive value appeared in application output");
  }
  assert(!/argon2id/.test(serializedResponses), "password hash marker appeared in responses");
  assert(!/eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/.test(serializedResponses), "JWT appeared in captured responses");
  console.log("ok - bid reveal secret leakage checks passed");
}

async function main() {
  assert(databaseUrl, "DATABASE_URL is required");

  let child = null;
  let getOutput = () => "";
  let databaseConnected = false;
  const client = new Client({ connectionString: databaseUrl });
  const sensitiveValues = [];

  try {
    await runCommand("npm", ["run", "build", "--workspace", "@auction/commitment"], rootDirectory);
    console.log("ok - shared commitment package builds");
    await runCommand("npm", ["run", "verify", "--workspace", "@auction/commitment"], rootDirectory);
    console.log("ok - shared commitment protocol verifies");
    const commitmentPackage = await import("@auction/commitment");
    computeBidCommitmentV1 = commitmentPackage.computeBidCommitmentV1;
    generateBidSecretV1 = commitmentPackage.generateBidSecretV1;
    commitmentProtocolVersion = commitmentPackage.COMMITMENT_PROTOCOL_VERSION;
    await runCommand("npm", ["run", "build"], apiDirectory);
    console.log("ok - NestJS application builds");

    await client.connect();
    databaseConnected = true;
    await client.query("SELECT 1");
    console.log("ok - PostgreSQL is reachable");

    const { adminId, bidderId } = await createTestUsers(client);
    const authAuction = await insertAuction(client, adminId);
    const validationAuction = await insertAuction(client, adminId);
    const validAuction = await insertAuction(client, adminId);
    const invalidAmountAuction = await insertAuction(client, adminId);
    const invalidSecretAuction = await insertAuction(client, adminId);
    const invalidRetryAuction = await insertAuction(client, adminId);
    const validRetryAuction = await insertAuction(client, adminId);
    const identifierAuction = await insertAuction(client, adminId);
    const identifierOtherAuction = await insertAuction(client, adminId);
    const staleAuction = await insertAuction(client, adminId);
    const concurrentValidAuction = await insertAuction(client, adminId);
    const concurrentInvalidAuction = await insertAuction(client, adminId);
    const raceAuction = await insertAuction(client, adminId);
    const statusAuction = await insertAuction(client, adminId);
    const phaseAuctions = await createPhaseAuctions(client, adminId);

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
    const secondBidderLogin = await login(secondBidderEmail, secondBidderPassword);
    assert(secondBidderLogin.statusCode === 201, "temporary second bidder login failed");
    const adminToken = adminLogin.body.accessToken;
    const bidderToken = bidderLogin.body.accessToken;
    const secondBidderToken = secondBidderLogin.body.accessToken;

    const authSetup = await createCommittedBid(client, bidderToken, authAuction, bidderId);
    await moveAuctionToReveal(client, authAuction);
    await verifyAuthorization(adminToken, bidderToken, authAuction, {
      clientRequestId: randomUUID(),
      amountCents: authSetup.amountCents,
      secret: authSetup.secret,
      expectedBidVersion: 1,
    });
    sensitiveValues.push(authSetup.secret, authSetup.commitmentHash);

    await verifyValidation(client, bidderToken, validationAuction);
    await verifyTiming(client, bidderToken, bidderId, phaseAuctions);
    const validResult = await verifyValidReveal(client, bidderToken, validAuction, bidderId);
    sensitiveValues.push(validResult.setup.secret, validResult.setup.commitmentHash);
    const invalidAmount = await verifyInvalidReveal(client, bidderToken, invalidAmountAuction, bidderId, "amount");
    sensitiveValues.push(invalidAmount.setup.secret, invalidAmount.setup.commitmentHash);
    const invalidSecret = await verifyInvalidReveal(client, bidderToken, invalidSecretAuction, bidderId, "secret");
    sensitiveValues.push(invalidSecret.body.secret, invalidSecret.setup.commitmentHash);
    await verifyInvalidRetry(client, bidderToken, invalidRetryAuction, bidderId);
    await verifyValidRetry(client, bidderToken, validRetryAuction, bidderId);
    await verifyIdentifierConflicts(
      client,
      bidderToken,
      secondBidderToken,
      identifierAuction,
      identifierOtherAuction,
      bidderId,
    );
    await verifyStaleAndExistingValid(client, bidderToken, staleAuction, bidderId);
    await verifyConcurrentValid(client, bidderToken, concurrentValidAuction, bidderId);
    await verifyConcurrentInvalid(client, bidderToken, concurrentInvalidAuction, bidderId);
    await verifyValidInvalidRace(client, bidderToken, raceAuction, bidderId);
    await verifyRevealStatus(client, bidderToken, secondBidderToken, statusAuction, bidderId);
    verifyNoLeakage(getOutput, sensitiveValues);

    console.log("ok - bid reveal integration verification passed");
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
