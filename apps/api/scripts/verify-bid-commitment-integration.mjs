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
const startupTimeoutMs = 10000;
const host = "127.0.0.1";
const port = 3105;
const runId = randomUUID();
const jwtSecret = randomBytes(32).toString("base64url");
const issuer = "bid-commitment-integration";
const audience = "bid-commitment-integration-web";
const adminEmail = `commitment-admin-${runId}@example.test`;
const bidderEmail = `commitment-bidder-${runId}@example.test`;
const secondBidderEmail = `commitment-bidder-2-${runId}@example.test`;
const adminPassword = "AuctionAdminTest123!";
const bidderPassword = "AuctionBidderTest123!";
const secondBidderPassword = "AuctionBidderTwo123!";
const createdAuctionIds = new Set();
const createdUserEmails = [adminEmail, bidderEmail, secondBidderEmail];
let commitmentProtocolVersion = 1;
let computeBidCommitmentV1;
let generateBidSecretV1;

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
  return { statusCode: response.status, headers: response.headers, body };
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

async function login(email, password) {
  return requestJson("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

function authHeaders(token) {
  return { Authorization: `Bearer ${token}` };
}

async function postCommitment(token, auctionId, body) {
  return requestJson(`/api/auctions/${auctionId}/commitments`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify(body),
  });
}

async function getParticipation(token, auctionId) {
  return requestJson(`/api/auctions/${auctionId}/participation`, {
    method: "GET",
    headers: authHeaders(token),
  });
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
  const startTime = overrides.startTime ?? minutesFrom(now, -60);
  const revealTime = overrides.revealTime ?? minutesFrom(now, 60);
  const endTime = overrides.endTime ?? minutesFrom(now, 120);
  await client.query(
    `
      INSERT INTO "Auction" (
        "id", "creationRequestId", "title", "description", "currency",
        "startTime", "revealTime", "endTime", "status", "createdById",
        "settledAt", "cancelledAt", "cancellationReason", "updatedAt"
      )
      VALUES ($1, $2, $3, 'Temporary bid commitment integration record', 'USD',
        $4, $5, $6, $7, $8, $9, $10, $11, NOW())
    `,
    [
      id,
      randomUUID(),
      overrides.title ?? `Bid Commitment Test ${runId}`,
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
      startTime: minutesFrom(now, -60),
      revealTime: minutesFrom(now, 60),
      endTime: minutesFrom(now, 120),
      title: `Bid Commitment Test ${runId} Draft`,
    }),
    scheduled: await insertAuction(client, adminId, {
      now,
      startTime: minutesFrom(now, 60),
      revealTime: minutesFrom(now, 120),
      endTime: minutesFrom(now, 180),
      title: `Bid Commitment Test ${runId} Scheduled`,
    }),
    commit: await insertAuction(client, adminId, {
      now,
      startTime: minutesFrom(now, -60),
      revealTime: minutesFrom(now, 60),
      endTime: minutesFrom(now, 120),
      title: `Bid Commitment Test ${runId} Commit`,
    }),
    reveal: await insertAuction(client, adminId, {
      now,
      startTime: minutesFrom(now, -120),
      revealTime: minutesFrom(now, -60),
      endTime: minutesFrom(now, 60),
      title: `Bid Commitment Test ${runId} Reveal`,
    }),
    ended: await insertAuction(client, adminId, {
      now,
      startTime: minutesFrom(now, -180),
      revealTime: minutesFrom(now, -120),
      endTime: minutesFrom(now, -60),
      title: `Bid Commitment Test ${runId} Ended`,
    }),
    cancelled: await insertAuction(client, adminId, {
      now,
      status: "CANCELLED",
      startTime: minutesFrom(now, -60),
      revealTime: minutesFrom(now, 60),
      endTime: minutesFrom(now, 120),
      cancelledAt: now,
      cancellationReason: "Temporary cancellation",
      title: `Bid Commitment Test ${runId} Cancelled`,
    }),
    settled: await insertAuction(client, adminId, {
      now,
      status: "SETTLED",
      startTime: minutesFrom(now, -180),
      revealTime: minutesFrom(now, -120),
      endTime: minutesFrom(now, -60),
      settledAt: now,
      title: `Bid Commitment Test ${runId} Settled`,
    }),
  };
}

async function commitmentBody(auctionId, bidderId, overrides = {}) {
  const secret = overrides.secret ?? generateBidSecretV1();
  const commitmentHash =
    overrides.commitmentHash ??
    (await computeBidCommitmentV1({
      auctionId,
      bidderId,
      currency: "USD",
      amountCents: overrides.amountCents ?? "12500",
      secret,
    }));
  return {
    clientRequestId: overrides.clientRequestId ?? randomUUID(),
    commitmentHash,
    protocolVersion: overrides.protocolVersion ?? commitmentProtocolVersion,
    ...(overrides.expectedBidVersion === undefined
      ? {}
      : { expectedBidVersion: overrides.expectedBidVersion }),
  };
}

async function countBidRows(client, auctionId, bidderId) {
  const result = await client.query(
    'SELECT COUNT(*)::int AS "count" FROM "Bid" WHERE "auctionId" = $1 AND "bidderId" = $2',
    [auctionId, bidderId],
  );
  return result.rows[0].count;
}

async function getBidState(client, auctionId, bidderId) {
  const bid = await client.query(
    'SELECT "id", "status", "version" FROM "Bid" WHERE "auctionId" = $1 AND "bidderId" = $2',
    [auctionId, bidderId],
  );
  if (bid.rowCount === 0) return null;
  const commitments = await client.query(
    `
      SELECT "id", "commitmentHash", "protocolVersion", "isCurrent", "replacedAt"
      FROM "BidCommitment"
      WHERE "bidId" = $1
      ORDER BY "committedAt" ASC, "id" ASC
    `,
    [bid.rows[0].id],
  );
  return { bid: bid.rows[0], commitments: commitments.rows };
}

function expectNoSensitiveFields(value, context) {
  const lower = JSON.stringify(value).toLowerCase();
  for (const field of [
    "clientRequestId",
    "bidderId",
    "amountCents",
    "price",
    "secret",
    "salt",
    "replacedAt",
    "historical",
  ]) {
    assert(!lower.includes(field.toLowerCase()), `${context} exposed ${field}`);
  }
}

async function verifyAuthorization(adminToken, bidderToken, auctionId, bidderId) {
  const body = await commitmentBody(auctionId, bidderId);
  const missingPost = await requestJson(`/api/auctions/${auctionId}/commitments`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  assert(missingPost.statusCode === 401, "missing POST auth expected 401");
  const invalidPost = await requestJson(`/api/auctions/${auctionId}/commitments`, {
    method: "POST",
    headers: { Authorization: "Bearer invalid-token" },
    body: JSON.stringify(body),
  });
  assert(invalidPost.statusCode === 401, "invalid POST auth expected 401");
  const adminPost = await postCommitment(adminToken, auctionId, body);
  assert(adminPost.statusCode === 403, "admin POST expected 403");

  const missingGet = await requestJson(`/api/auctions/${auctionId}/participation`, {
    method: "GET",
  });
  assert(missingGet.statusCode === 401, "missing GET auth expected 401");
  const invalidGet = await requestJson(`/api/auctions/${auctionId}/participation`, {
    method: "GET",
    headers: { Authorization: "Bearer invalid-token" },
  });
  assert(invalidGet.statusCode === 401, "invalid GET auth expected 401");
  const adminGet = await getParticipation(adminToken, auctionId);
  assert(adminGet.statusCode === 403, "admin GET expected 403");
  const bidderGet = await getParticipation(bidderToken, auctionId);
  assert(bidderGet.statusCode === 200, "bidder GET expected 200");
  const bidderPost = await postCommitment(bidderToken, auctionId, body);
  assert(bidderPost.statusCode === 201, "bidder POST expected 201");

  console.log("ok - bid commitment authorization passed");
}

async function verifyValidation(client, bidderToken, auctionId, bidderId) {
  const valid = await commitmentBody(auctionId, bidderId, { expectedBidVersion: 0 });
  const invalidBodies = [
    { ...valid, clientRequestId: undefined },
    { ...valid, clientRequestId: "not-a-uuid" },
    { ...valid, commitmentHash: valid.commitmentHash.toUpperCase() },
    { ...valid, commitmentHash: valid.commitmentHash.slice(0, 63) },
    { ...valid, commitmentHash: `${valid.commitmentHash.slice(0, 63)}z` },
    { ...valid, protocolVersion: 2 },
    { ...valid, expectedBidVersion: -1 },
    { ...valid, expectedBidVersion: 1.5 },
    { ...valid, amountCents: "12500" },
    { ...valid, price: "125.00" },
    { ...valid, secret: generateBidSecretV1() },
    { ...valid, salt: "salt" },
    { ...valid, unknown: true },
  ];

  for (const body of invalidBodies) {
    const cleanBody = Object.fromEntries(
      Object.entries(body).filter(([, value]) => value !== undefined),
    );
    const response = await postCommitment(bidderToken, auctionId, cleanBody);
    assert(response.statusCode === 400, `invalid body expected 400, got ${response.statusCode}`);
  }
  assert(
    (await countBidRows(client, auctionId, bidderId)) === 0,
    "invalid requests created bid records",
  );

  console.log("ok - bid commitment validation passed");
}

async function verifyTiming(bidderToken, bidderId, phaseAuctions) {
  for (const [phase, auctionId] of Object.entries(phaseAuctions)) {
    const body = await commitmentBody(auctionId, bidderId, { expectedBidVersion: 0 });
    const response = await postCommitment(bidderToken, auctionId, body);
    if (phase === "commit") {
      assert(response.statusCode === 201, "commit phase expected 201");
    } else if (phase === "draft" || phase === "cancelled") {
      assert(response.statusCode === 404, `${phase} expected 404`);
    } else {
      assert(response.statusCode === 409, `${phase} expected 409`);
      assert(
        response.body.message === "Auction is not accepting commitments",
        `${phase} conflict message mismatch`,
      );
    }
  }

  console.log("ok - bid commitment timing passed");
}

async function verifyFirstCommitment(client, bidderToken, auctionId, bidderId) {
  const body = await commitmentBody(auctionId, bidderId, { expectedBidVersion: 0 });
  const response = await postCommitment(bidderToken, auctionId, body);
  assert(response.statusCode === 201, "first commitment expected 201");
  assert(response.body.bid.version === 1, "first bid version mismatch");
  assert(response.body.replacedPreviousCommitment === false, "first replacement flag mismatch");
  assert(response.body.commitment.commitmentHash === body.commitmentHash, "commitment hash mismatch");
  assert(!Number.isNaN(Date.parse(response.body.serverTime)), "serverTime missing");
  expectNoSensitiveFields(response.body, "first commitment response");

  const state = await getBidState(client, auctionId, bidderId);
  assert(state?.bid.version === 1, "stored first bid version mismatch");
  assert(state.commitments.length === 1, "first commitment row count mismatch");
  assert(state.commitments[0].isCurrent === true, "first commitment not current");
  assert(state.commitments[0].replacedAt === null, "first commitment has replacement timestamp");

  console.log("ok - first bid commitment passed");
  return { body, response };
}

async function verifyIdempotency(client, bidderToken, secondBidderToken, auctionId, otherAuctionId, bidderId) {
  const body = await commitmentBody(auctionId, bidderId, { expectedBidVersion: 0 });
  const first = await postCommitment(bidderToken, auctionId, body);
  assert(first.statusCode === 201, "idempotent first submit expected 201");

  await client.query(
    `UPDATE "Auction" SET "status" = 'SETTLED', "settledAt" = NOW(), "updatedAt" = NOW() WHERE "id" = $1`,
    [auctionId],
  );

  const retry = await postCommitment(bidderToken, auctionId, body);
  assert(retry.statusCode === 201, "exact retry after closure expected 201");
  assert(retry.body.bid.id === first.body.bid.id, "retry returned different bid id");
  assert(retry.body.commitment.id === first.body.commitment.id, "retry returned different commitment id");
  const state = await getBidState(client, auctionId, bidderId);
  assert(state.commitments.length === 1, "retry created duplicate commitment");
  assert(state.bid.version === 1, "retry changed bid version");

  const changedHash = await postCommitment(bidderToken, auctionId, {
    ...body,
    commitmentHash: "a".repeat(64),
  });
  assert(changedHash.statusCode === 409, "changed hash retry expected 409");

  const changedAuction = await postCommitment(bidderToken, otherAuctionId, body);
  assert(changedAuction.statusCode === 409, "changed auction retry expected 409");

  const changedBidder = await postCommitment(secondBidderToken, auctionId, body);
  assert(changedBidder.statusCode === 409, "changed bidder retry expected 409");

  console.log("ok - bid commitment idempotency passed");
}

async function verifyReplacement(client, bidderToken, auctionId, bidderId) {
  const firstBody = await commitmentBody(auctionId, bidderId, { expectedBidVersion: 0 });
  const first = await postCommitment(bidderToken, auctionId, firstBody);
  assert(first.statusCode === 201, "replacement setup expected 201");

  const missingVersion = await postCommitment(
    bidderToken,
    auctionId,
    await commitmentBody(auctionId, bidderId),
  );
  assert(missingVersion.statusCode === 409, "missing replacement version expected 409");

  const secondBody = await commitmentBody(auctionId, bidderId, { expectedBidVersion: 1 });
  const second = await postCommitment(bidderToken, auctionId, secondBody);
  assert(second.statusCode === 201, "replacement expected 201");
  assert(second.body.replacedPreviousCommitment === true, "replacement flag mismatch");
  assert(second.body.bid.version === 2, "replacement did not increment version");
  expectNoSensitiveFields(second.body, "replacement response");

  const state = await getBidState(client, auctionId, bidderId);
  assert(state.bid.version === 2, "stored replacement version mismatch");
  assert(state.commitments.length === 2, "replacement history count mismatch");
  assert(state.commitments.filter((commitment) => commitment.isCurrent).length === 1, "current count mismatch");
  assert(state.commitments[0].isCurrent === false, "old commitment still current");
  assert(state.commitments[0].replacedAt instanceof Date, "old commitment replacement timestamp missing");
  assert(state.commitments[1].isCurrent === true, "new commitment not current");

  const stale = await postCommitment(
    bidderToken,
    auctionId,
    await commitmentBody(auctionId, bidderId, { expectedBidVersion: 1 }),
  );
  assert(stale.statusCode === 409, "stale replacement expected 409");

  const reusedHash = await postCommitment(bidderToken, auctionId, {
    ...(await commitmentBody(auctionId, bidderId, { expectedBidVersion: 2 })),
    commitmentHash: firstBody.commitmentHash,
  });
  assert(reusedHash.statusCode === 409, "reused old hash expected 409");

  console.log("ok - bid commitment replacement passed");
}

async function verifyConcurrentFirst(client, bidderToken, auctionId, bidderId) {
  const [first, second] = await Promise.all([
    postCommitment(
      bidderToken,
      auctionId,
      await commitmentBody(auctionId, bidderId, { expectedBidVersion: 0, amountCents: "11100" }),
    ),
    postCommitment(
      bidderToken,
      auctionId,
      await commitmentBody(auctionId, bidderId, { expectedBidVersion: 0, amountCents: "22200" }),
    ),
  ]);
  const statuses = [first.statusCode, second.statusCode].sort();
  assert(JSON.stringify(statuses) === JSON.stringify([201, 409]), "concurrent first status mismatch");
  const state = await getBidState(client, auctionId, bidderId);
  assert(state.bid.version === 1, "concurrent first version mismatch");
  assert(state.commitments.length === 1, "concurrent first commitment count mismatch");
  assert(state.commitments.filter((commitment) => commitment.isCurrent).length === 1, "concurrent first current count mismatch");

  console.log("ok - concurrent first commitment passed");
}

async function verifyConcurrentReplacement(client, bidderToken, auctionId, bidderId) {
  const first = await postCommitment(
    bidderToken,
    auctionId,
    await commitmentBody(auctionId, bidderId, { expectedBidVersion: 0 }),
  );
  assert(first.statusCode === 201, "concurrent replacement setup expected 201");
  const [replaceA, replaceB] = await Promise.all([
    postCommitment(
      bidderToken,
      auctionId,
      await commitmentBody(auctionId, bidderId, { expectedBidVersion: 1, amountCents: "33300" }),
    ),
    postCommitment(
      bidderToken,
      auctionId,
      await commitmentBody(auctionId, bidderId, { expectedBidVersion: 1, amountCents: "44400" }),
    ),
  ]);
  const statuses = [replaceA.statusCode, replaceB.statusCode].sort();
  assert(JSON.stringify(statuses) === JSON.stringify([201, 409]), "concurrent replacement status mismatch");
  const state = await getBidState(client, auctionId, bidderId);
  assert(state.bid.version === 2, "concurrent replacement version mismatch");
  assert(state.commitments.length === 2, "concurrent replacement history mismatch");
  assert(state.commitments.filter((commitment) => commitment.isCurrent).length === 1, "concurrent replacement current count mismatch");

  console.log("ok - concurrent replacement passed");
}

async function verifyParticipation(client, bidderToken, secondBidderToken, auctionId, bidderId, secondBidderId) {
  const before = await getParticipation(bidderToken, auctionId);
  assert(before.statusCode === 200, "participation before expected 200");
  assert(before.body.participation === null, "participation before should be null");
  assert(before.body.canCommit === true, "commit auction should be committable");

  const body = await commitmentBody(auctionId, bidderId, { expectedBidVersion: 0 });
  const submitted = await postCommitment(bidderToken, auctionId, body);
  assert(submitted.statusCode === 201, "participation setup expected 201");
  const replacement = await postCommitment(
    bidderToken,
    auctionId,
    await commitmentBody(auctionId, bidderId, { expectedBidVersion: 1 }),
  );
  assert(replacement.statusCode === 201, "participation replacement expected 201");

  const after = await getParticipation(bidderToken, auctionId);
  assert(after.statusCode === 200, "participation after expected 200");
  assert(after.body.participation.bidId === submitted.body.bid.id, "participation bid id mismatch");
  assert(after.body.participation.version === 2, "participation version mismatch");
  assert(
    after.body.participation.currentCommitment.id === replacement.body.commitment.id,
    "participation current commitment mismatch",
  );
  expectNoSensitiveFields(after.body, "participation response");

  const isolated = await getParticipation(secondBidderToken, auctionId);
  assert(isolated.statusCode === 200, "second bidder participation expected 200");
  assert(isolated.body.participation === null, "second bidder saw another bidder participation");

  const secondSubmit = await postCommitment(
    secondBidderToken,
    auctionId,
    await commitmentBody(auctionId, secondBidderId, { expectedBidVersion: 0 }),
  );
  assert(secondSubmit.statusCode === 201, "second bidder submit expected 201");
  const firstStill = await getParticipation(bidderToken, auctionId);
  assert(
    firstStill.body.participation.currentCommitment.id === replacement.body.commitment.id,
    "first bidder participation changed after second bidder submit",
  );

  console.log("ok - bid participation and cross-bidder isolation passed");
}

async function main() {
  assert(databaseUrl, "DATABASE_URL is required");

  let child = null;
  let getOutput = () => "";
  let databaseConnected = false;
  const client = new Client({ connectionString: databaseUrl });

  try {
    await runCommand("npm", ["run", "build", "--workspace", "@auction/commitment"], rootDirectory);
    console.log("ok - shared commitment package builds");
    await runCommand("npm", ["run", "verify", "--workspace", "@auction/commitment"], rootDirectory);
    console.log("ok - shared commitment protocol verifies");
    const commitmentPackage = await import("@auction/commitment");
    commitmentProtocolVersion = commitmentPackage.COMMITMENT_PROTOCOL_VERSION;
    computeBidCommitmentV1 = commitmentPackage.computeBidCommitmentV1;
    generateBidSecretV1 = commitmentPackage.generateBidSecretV1;
    await runCommand("npm", ["run", "build"], apiDirectory);
    console.log("ok - NestJS application builds");

    await client.connect();
    databaseConnected = true;
    await client.query("SELECT 1");
    console.log("ok - PostgreSQL is reachable");

    const { adminId, bidderId, secondBidderId } = await createTestUsers(client);
    const authAuction = await insertAuction(client, adminId);
    const validationAuction = await insertAuction(client, adminId);
    const firstAuction = await insertAuction(client, adminId);
    const idempotencyAuction = await insertAuction(client, adminId);
    const idempotencyOtherAuction = await insertAuction(client, adminId);
    const replacementAuction = await insertAuction(client, adminId);
    const concurrentFirstAuction = await insertAuction(client, adminId);
    const concurrentReplacementAuction = await insertAuction(client, adminId);
    const participationAuction = await insertAuction(client, adminId);
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

    await verifyAuthorization(adminToken, bidderToken, authAuction, bidderId);
    await verifyValidation(client, bidderToken, validationAuction, bidderId);
    await verifyTiming(bidderToken, bidderId, phaseAuctions);
    await verifyFirstCommitment(client, bidderToken, firstAuction, bidderId);
    await verifyIdempotency(
      client,
      bidderToken,
      secondBidderToken,
      idempotencyAuction,
      idempotencyOtherAuction,
      bidderId,
    );
    await verifyReplacement(client, bidderToken, replacementAuction, bidderId);
    await verifyConcurrentFirst(client, bidderToken, concurrentFirstAuction, bidderId);
    await verifyConcurrentReplacement(client, bidderToken, concurrentReplacementAuction, bidderId);
    await verifyParticipation(
      client,
      bidderToken,
      secondBidderToken,
      participationAuction,
      bidderId,
      secondBidderId,
    );

    console.log("ok - bid commitment integration verification passed");
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
