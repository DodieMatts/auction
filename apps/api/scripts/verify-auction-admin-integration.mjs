import "reflect-metadata";
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
const envPath = resolve(apiDirectory, ".env");
const startupTimeoutMs = 10000;
const host = "127.0.0.1";
const port = 3103;
const runId = randomUUID();
const jwtSecret = randomBytes(32).toString("base64url");
const issuer = "auction-admin-integration";
const audience = "auction-admin-integration-web";
const adminEmail = `auction-admin-${runId}@example.test`;
const bidderEmail = `auction-bidder-${runId}@example.test`;
const adminPassword = "AuctionAdminTest123!";
const bidderPassword = "AuctionBidderTest123!";
const createdAuctionIds = new Set();

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

async function runCommand(command, args) {
  return new Promise((resolveCommand, rejectCommand) => {
    const child = spawn(command, args, {
      cwd: apiDirectory,
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

function isoOffset(minutes) {
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

function createAuctionPayload(overrides = {}) {
  return {
    creationRequestId: randomUUID(),
    title: `Auction Admin Test ${runId}`,
    description: "Temporary auction admin integration record",
    currency: "usd",
    startTime: isoOffset(180),
    revealTime: isoOffset(240),
    endTime: isoOffset(300),
    ...overrides,
  };
}

async function adminRequest(token, method, pathname, body = undefined) {
  return requestJson(pathname, {
    method,
    headers: { Authorization: `Bearer ${token}` },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function login(email, password) {
  return requestJson("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

async function createTestUsers(client) {
  await cleanup(client);
  const adminId = randomUUID();
  const bidderId = randomUUID();
  await client.query(
    `
      INSERT INTO "User" ("id", "email", "passwordHash", "role", "status", "updatedAt")
      VALUES
      ($1, $2, $3, 'ADMIN', 'ACTIVE', NOW()),
      ($4, $5, $6, 'BIDDER', 'ACTIVE', NOW())
    `,
    [
      adminId,
      adminEmail,
      await argon2.hash(adminPassword, { type: argon2.argon2id }),
      bidderId,
      bidderEmail,
      await argon2.hash(bidderPassword, { type: argon2.argon2id }),
    ],
  );
  return { adminId, bidderId };
}

async function cleanup(client) {
  const ids = [...createdAuctionIds];
  if (ids.length > 0) {
    await client.query('DELETE FROM "Auction" WHERE "id" = ANY($1)', [ids]);
  }
  await client.query('DELETE FROM "Auction" WHERE "title" LIKE $1', [
    `Auction Admin Test ${runId}%`,
  ]);
  await client.query('DELETE FROM "User" WHERE "email" = ANY($1)', [
    [adminEmail, bidderEmail],
  ]);
}

async function insertAuction(client, adminId, overrides = {}) {
  const id = overrides.id ?? randomUUID();
  createdAuctionIds.add(id);
  const startTime = overrides.startTime ?? new Date(Date.now() + 180 * 60_000);
  const revealTime = overrides.revealTime ?? new Date(Date.now() + 240 * 60_000);
  const endTime = overrides.endTime ?? new Date(Date.now() + 300 * 60_000);
  const status = overrides.status ?? "DRAFT";
  await client.query(
    `
      INSERT INTO "Auction" (
        "id", "creationRequestId", "title", "description", "currency",
        "startTime", "revealTime", "endTime", "status", "createdById",
        "settledAt", "cancelledAt", "cancellationReason", "version", "updatedAt"
      )
      VALUES ($1, $2, $3, $4, 'USD', $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW())
    `,
    [
      id,
      overrides.creationRequestId ?? randomUUID(),
      overrides.title ?? `Auction Admin Test ${runId} Direct`,
      overrides.description ?? null,
      startTime,
      revealTime,
      endTime,
      status,
      adminId,
      overrides.settledAt ?? null,
      overrides.cancelledAt ?? null,
      overrides.cancellationReason ?? null,
      overrides.version ?? 0,
    ],
  );
  return id;
}

async function getAuctionRow(client, id) {
  const result = await client.query('SELECT * FROM "Auction" WHERE "id" = $1', [id]);
  return result.rows[0];
}

function expectHiddenIds(responseBody, label) {
  const text = JSON.stringify(responseBody);
  assert(!text.includes("creationRequestId"), `${label} exposed creationRequestId`);
  assert(!text.includes("settlementRequestId"), `${label} exposed settlementRequestId`);
  assert(!text.includes("cancellationRequestId"), `${label} exposed cancellationRequestId`);
}

async function verifyAuthorization(adminToken, bidderToken) {
  const missing = await requestJson("/api/admin/auctions");
  assert(missing.statusCode === 401, `missing auth expected 401, got ${missing.statusCode}`);

  const bidder = await adminRequest(bidderToken, "GET", "/api/admin/auctions");
  assert(bidder.statusCode === 403, `bidder auth expected 403, got ${bidder.statusCode}`);

  const admin = await adminRequest(adminToken, "GET", "/api/admin/auctions");
  assert(admin.statusCode === 200, `admin listing expected 200, got ${admin.statusCode}`);
  console.log("ok - auction admin authorization passed");
}

async function verifyCreation(adminToken, adminId, client) {
  const payload = createAuctionPayload();
  const created = await adminRequest(adminToken, "POST", "/api/admin/auctions", payload);
  assert(created.statusCode === 201, `draft creation expected 201, got ${created.statusCode}`);
  createdAuctionIds.add(created.body.auction.id);
  assert(created.body.auction.status === "DRAFT", "created auction status mismatch");
  assert(created.body.auction.phase === "DRAFT", "created auction phase mismatch");
  assert(created.body.serverTime, "created auction missing serverTime");
  assert(created.body.auction.createdById === adminId, "createdById mismatch");
  expectHiddenIds(created.body, "create response");

  const retry = await adminRequest(adminToken, "POST", "/api/admin/auctions", payload);
  assert(retry.statusCode === 201, `idempotent retry expected 201, got ${retry.statusCode}`);
  assert(retry.body.auction.id === created.body.auction.id, "idempotent retry returned different auction");

  const duplicateCount = await client.query(
    'SELECT COUNT(*)::int AS count FROM "Auction" WHERE "creationRequestId" = $1',
    [payload.creationRequestId],
  );
  assert(duplicateCount.rows[0].count === 1, "idempotent retry created duplicate row");

  const conflict = await adminRequest(adminToken, "POST", "/api/admin/auctions", {
    ...payload,
    title: `${payload.title} Changed`,
  });
  assert(conflict.statusCode === 409, `conflicting request expected 409, got ${conflict.statusCode}`);

  const invalidOrder = await adminRequest(adminToken, "POST", "/api/admin/auctions", {
    ...createAuctionPayload(),
    startTime: isoOffset(300),
    revealTime: isoOffset(240),
    endTime: isoOffset(360),
  });
  assert(invalidOrder.statusCode === 400, "invalid time ordering expected 400");

  const nonfuture = await adminRequest(adminToken, "POST", "/api/admin/auctions", {
    ...createAuctionPayload(),
    startTime: isoOffset(-1),
  });
  assert(nonfuture.statusCode === 400, "nonfuture start expected 400");

  const invalidCurrency = await adminRequest(adminToken, "POST", "/api/admin/auctions", {
    ...createAuctionPayload(),
    currency: "US1",
  });
  assert(invalidCurrency.statusCode === 400, "invalid currency expected 400");

  const unknownProperty = await adminRequest(adminToken, "POST", "/api/admin/auctions", {
    ...createAuctionPayload(),
    unexpected: true,
  });
  assert(unknownProperty.statusCode === 400, "unknown property expected 400");

  console.log("ok - auction creation tests passed");
  return created.body.auction;
}

async function verifyListingAndDetails(adminToken, auction) {
  const list = await adminRequest(adminToken, "GET", "/api/admin/auctions?page=1&limit=100");
  assert(list.statusCode === 200, `listing expected 200, got ${list.statusCode}`);
  assert(
    list.body.data.some((item) => item.id === auction.id),
    "created auction missing from listing",
  );
  assert(list.body.pagination.page === 1, "listing page metadata mismatch");
  assert(list.body.pagination.limit === 100, "listing limit metadata mismatch");
  assert(list.body.pagination.total >= 1, "listing total metadata mismatch");
  expectHiddenIds(list.body, "listing response");

  const filtered = await adminRequest(adminToken, "GET", "/api/admin/auctions?status=DRAFT");
  assert(filtered.statusCode === 200, "status-filtered listing expected 200");
  assert(filtered.body.data.every((item) => item.status === "DRAFT"), "status filtering failed");

  const detail = await adminRequest(adminToken, "GET", `/api/admin/auctions/${auction.id}`);
  assert(detail.statusCode === 200, `detail expected 200, got ${detail.statusCode}`);
  assert(detail.body.auction.id === auction.id, "detail returned wrong auction");
  expectHiddenIds(detail.body, "detail response");

  const missing = await adminRequest(adminToken, "GET", `/api/admin/auctions/${randomUUID()}`);
  assert(missing.statusCode === 404, "missing detail expected 404");

  console.log("ok - listing and detail tests passed");
}

async function verifyUpdates(adminToken, client, adminId) {
  const payload = createAuctionPayload();
  const created = await adminRequest(adminToken, "POST", "/api/admin/auctions", payload);
  const auction = created.body.auction;
  createdAuctionIds.add(auction.id);

  const updated = await adminRequest(adminToken, "PATCH", `/api/admin/auctions/${auction.id}`, {
    expectedVersion: auction.version,
    title: `${auction.title} Updated`,
  });
  assert(updated.statusCode === 200, `draft update expected 200, got ${updated.statusCode}`);
  assert(updated.body.auction.version === auction.version + 1, "update did not increment version once");

  const empty = await adminRequest(adminToken, "PATCH", `/api/admin/auctions/${auction.id}`, {
    expectedVersion: updated.body.auction.version,
  });
  assert(empty.statusCode === 400, "empty update expected 400");

  const stale = await adminRequest(adminToken, "PATCH", `/api/admin/auctions/${auction.id}`, {
    expectedVersion: auction.version,
    title: "Stale title",
  });
  assert(stale.statusCode === 409, "stale update expected 409");

  const invalidMerged = await adminRequest(adminToken, "PATCH", `/api/admin/auctions/${auction.id}`, {
    expectedVersion: updated.body.auction.version,
    revealTime: updated.body.auction.startTime,
  });
  assert(invalidMerged.statusCode === 400, "invalid merged schedule expected 400");

  const expiredDraftId = await insertAuction(client, adminId, {
    title: `Auction Admin Test ${runId} Expired Draft`,
    startTime: new Date(Date.now() - 300 * 60_000),
    revealTime: new Date(Date.now() - 240 * 60_000),
    endTime: new Date(Date.now() - 180 * 60_000),
  });
  const rescheduled = await adminRequest(adminToken, "PATCH", `/api/admin/auctions/${expiredDraftId}`, {
    expectedVersion: 0,
    startTime: isoOffset(200),
    revealTime: isoOffset(260),
    endTime: isoOffset(320),
  });
  assert(rescheduled.statusCode === 200, "expired draft reschedule expected 200");

  const publish = await adminRequest(adminToken, "POST", `/api/admin/auctions/${auction.id}/publish`, {
    expectedVersion: updated.body.auction.version,
  });
  assert(
    publish.statusCode === 200,
    `publish before published-edit test expected 200, got ${publish.statusCode}: ${JSON.stringify(publish.body)}`,
  );
  const publishedEdit = await adminRequest(adminToken, "PATCH", `/api/admin/auctions/${auction.id}`, {
    expectedVersion: publish.body.auction.version,
    title: "Cannot edit",
  });
  assert(publishedEdit.statusCode === 409, "published edit expected 409");

  console.log("ok - update tests passed");
}

async function verifyConcurrentUpdate(adminToken, client) {
  const created = await adminRequest(adminToken, "POST", "/api/admin/auctions", createAuctionPayload());
  const auction = created.body.auction;
  createdAuctionIds.add(auction.id);
  const titleA = `${auction.title} Concurrent A`;
  const titleB = `${auction.title} Concurrent B`;
  const [responseA, responseB] = await Promise.all([
    adminRequest(adminToken, "PATCH", `/api/admin/auctions/${auction.id}`, {
      expectedVersion: auction.version,
      title: titleA,
    }),
    adminRequest(adminToken, "PATCH", `/api/admin/auctions/${auction.id}`, {
      expectedVersion: auction.version,
      title: titleB,
    }),
  ]);
  const statuses = [responseA.statusCode, responseB.statusCode].sort();
  assert(statuses[0] === 200 && statuses[1] === 409, `concurrent update statuses ${statuses.join(",")}`);
  const successfulTitle = responseA.statusCode === 200 ? titleA : titleB;
  const row = await getAuctionRow(client, auction.id);
  assert(row.version === auction.version + 1, "concurrent update incremented version incorrectly");
  assert(row.title === successfulTitle, "concurrent update stored wrong title");
  console.log("ok - concurrent update test passed");
}

async function verifyPublication(adminToken, client, adminId) {
  const created = await adminRequest(adminToken, "POST", "/api/admin/auctions", createAuctionPayload());
  const auction = created.body.auction;
  createdAuctionIds.add(auction.id);
  const published = await adminRequest(adminToken, "POST", `/api/admin/auctions/${auction.id}/publish`, {
    expectedVersion: auction.version,
  });
  assert(published.statusCode === 200, "valid publication expected 200");
  assert(published.body.auction.status === "PUBLISHED", "published status mismatch");
  assert(published.body.auction.version === auction.version + 1, "publish version mismatch");

  const repeated = await adminRequest(adminToken, "POST", `/api/admin/auctions/${auction.id}/publish`, {
    expectedVersion: auction.version,
  });
  assert(repeated.statusCode === 200, "repeated publication expected 200");
  assert(repeated.body.auction.id === auction.id, "repeated publication returned wrong auction");
  const count = await client.query('SELECT COUNT(*)::int AS count FROM "Auction" WHERE "id" = $1', [auction.id]);
  assert(count.rows[0].count === 1, "repeated publication created additional row");

  const staleCreated = await adminRequest(adminToken, "POST", "/api/admin/auctions", createAuctionPayload());
  createdAuctionIds.add(staleCreated.body.auction.id);
  await adminRequest(adminToken, "PATCH", `/api/admin/auctions/${staleCreated.body.auction.id}`, {
    expectedVersion: 0,
    title: "Version bump before stale publish",
  });
  const stalePublish = await adminRequest(adminToken, "POST", `/api/admin/auctions/${staleCreated.body.auction.id}/publish`, {
    expectedVersion: 0,
  });
  assert(stalePublish.statusCode === 409, "stale draft publication expected 409");

  const expiredId = await insertAuction(client, adminId, {
    title: `Auction Admin Test ${runId} Expired Publish`,
    startTime: new Date(Date.now() - 120 * 60_000),
    revealTime: new Date(Date.now() + 60 * 60_000),
    endTime: new Date(Date.now() + 120 * 60_000),
  });
  const expiredPublish = await adminRequest(adminToken, "POST", `/api/admin/auctions/${expiredId}/publish`, {
    expectedVersion: 0,
  });
  assert(expiredPublish.statusCode === 409, "expired start publish expected 409");
  console.log("ok - publication tests passed");
}

async function verifyConcurrentPublication(adminToken, client) {
  const created = await adminRequest(adminToken, "POST", "/api/admin/auctions", createAuctionPayload());
  const auction = created.body.auction;
  createdAuctionIds.add(auction.id);
  const [a, b] = await Promise.all([
    adminRequest(adminToken, "POST", `/api/admin/auctions/${auction.id}/publish`, { expectedVersion: auction.version }),
    adminRequest(adminToken, "POST", `/api/admin/auctions/${auction.id}/publish`, { expectedVersion: auction.version }),
  ]);
  const statuses = [a.statusCode, b.statusCode].sort();
  assert(
    (statuses[0] === 200 && statuses[1] === 200) || (statuses[0] === 200 && statuses[1] === 409),
    `unexpected concurrent publication statuses ${statuses.join(",")}`,
  );
  const row = await getAuctionRow(client, auction.id);
  assert(row.status === "PUBLISHED", "concurrent publication final status mismatch");
  assert(row.version === auction.version + 1, "concurrent publication version increment mismatch");
  console.log("ok - concurrent publication test passed");
}

async function verifyCancellation(adminToken, client, adminId) {
  const draft = await adminRequest(adminToken, "POST", "/api/admin/auctions", createAuctionPayload());
  const draftAuction = draft.body.auction;
  createdAuctionIds.add(draftAuction.id);
  const cancellationRequestId = randomUUID();
  const cancelled = await adminRequest(adminToken, "POST", `/api/admin/auctions/${draftAuction.id}/cancel`, {
    cancellationRequestId,
    expectedVersion: draftAuction.version,
    reason: "Administrative test cancellation",
  });
  assert(cancelled.statusCode === 200, "draft cancellation expected 200");
  assert(cancelled.body.auction.status === "CANCELLED", "draft cancellation status mismatch");
  assert(cancelled.body.auction.cancellationReason === "Administrative test cancellation", "cancellation reason mismatch");
  assert(cancelled.body.auction.version === draftAuction.version + 1, "cancellation version mismatch");

  const retry = await adminRequest(adminToken, "POST", `/api/admin/auctions/${draftAuction.id}/cancel`, {
    cancellationRequestId,
    expectedVersion: draftAuction.version,
    reason: "Administrative test cancellation",
  });
  assert(retry.statusCode === 200, "identical cancellation retry expected 200");

  const other = await adminRequest(adminToken, "POST", "/api/admin/auctions", createAuctionPayload());
  createdAuctionIds.add(other.body.auction.id);
  const reusedElsewhere = await adminRequest(adminToken, "POST", `/api/admin/auctions/${other.body.auction.id}/cancel`, {
    cancellationRequestId,
    expectedVersion: other.body.auction.version,
    reason: "Administrative test cancellation",
  });
  assert(reusedElsewhere.statusCode === 409, "reused cancellation id elsewhere expected 409");

  const recancel = await adminRequest(adminToken, "POST", `/api/admin/auctions/${draftAuction.id}/cancel`, {
    cancellationRequestId: randomUUID(),
    expectedVersion: cancelled.body.auction.version,
    reason: "Different request",
  });
  assert(recancel.statusCode === 409, "different cancellation id recancel expected 409");

  const futurePublished = await adminRequest(adminToken, "POST", "/api/admin/auctions", createAuctionPayload());
  createdAuctionIds.add(futurePublished.body.auction.id);
  const published = await adminRequest(adminToken, "POST", `/api/admin/auctions/${futurePublished.body.auction.id}/publish`, {
    expectedVersion: futurePublished.body.auction.version,
  });
  const cancelPublished = await adminRequest(adminToken, "POST", `/api/admin/auctions/${futurePublished.body.auction.id}/cancel`, {
    cancellationRequestId: randomUUID(),
    expectedVersion: published.body.auction.version,
    reason: "Future published cancellation",
  });
  assert(cancelPublished.statusCode === 200, "future published cancellation expected 200");

  const settledId = await insertAuction(client, adminId, {
    title: `Auction Admin Test ${runId} Settled`,
    status: "SETTLED",
    settledAt: new Date(),
  });
  const settledCancel = await adminRequest(adminToken, "POST", `/api/admin/auctions/${settledId}/cancel`, {
    cancellationRequestId: randomUUID(),
    expectedVersion: 0,
    reason: "Cannot cancel settled",
  });
  assert(settledCancel.statusCode === 409, "settled cancellation expected 409");

  const startedId = await insertAuction(client, adminId, {
    title: `Auction Admin Test ${runId} Started`,
    status: "PUBLISHED",
    startTime: new Date(Date.now() - 60 * 60_000),
    revealTime: new Date(Date.now() + 60 * 60_000),
    endTime: new Date(Date.now() + 120 * 60_000),
  });
  const startedCancel = await adminRequest(adminToken, "POST", `/api/admin/auctions/${startedId}/cancel`, {
    cancellationRequestId: randomUUID(),
    expectedVersion: 0,
    reason: "Cannot cancel started",
  });
  assert(startedCancel.statusCode === 409, "started published cancellation expected 409");
  console.log("ok - cancellation tests passed");
}

async function verifyBoundaryPhases(adminToken, client, adminId) {
  const cases = [
    { title: "Scheduled", status: "PUBLISHED", start: 120, reveal: 180, end: 240, phase: "SCHEDULED" },
    { title: "Commit", status: "PUBLISHED", start: -60, reveal: 60, end: 120, phase: "COMMIT" },
    { title: "Reveal", status: "PUBLISHED", start: -120, reveal: -60, end: 60, phase: "REVEAL" },
    { title: "Ended", status: "PUBLISHED", start: -180, reveal: -120, end: -60, phase: "ENDED" },
    { title: "Cancelled", status: "CANCELLED", start: 120, reveal: 180, end: 240, phase: "CANCELLED", cancelledAt: new Date(), cancellationReason: "Boundary cancellation" },
    { title: "Settled", status: "SETTLED", start: -180, reveal: -120, end: -60, phase: "SETTLED", settledAt: new Date() },
    { title: "Draft", status: "DRAFT", start: -180, reveal: -120, end: -60, phase: "DRAFT" },
  ];
  for (const testCase of cases) {
    const id = await insertAuction(client, adminId, {
      title: `Auction Admin Test ${runId} Phase ${testCase.title}`,
      status: testCase.status,
      startTime: new Date(Date.now() + testCase.start * 60_000),
      revealTime: new Date(Date.now() + testCase.reveal * 60_000),
      endTime: new Date(Date.now() + testCase.end * 60_000),
      cancelledAt: testCase.cancelledAt ?? null,
      cancellationReason: testCase.cancellationReason ?? null,
      settledAt: testCase.settledAt ?? null,
    });
    const detail = await adminRequest(adminToken, "GET", `/api/admin/auctions/${id}`);
    assert(detail.statusCode === 200, `phase detail expected 200 for ${testCase.title}`);
    assert(detail.body.auction.phase === testCase.phase, `${testCase.title} phase expected ${testCase.phase}, got ${detail.body.auction.phase}`);
  }
  console.log("ok - boundary phase tests passed");
}

async function main() {
  assert(databaseUrl, "DATABASE_URL is required");
  await runCommand("npm", ["run", "build"]);
  console.log("ok - NestJS application builds");
  const client = new Client({ connectionString: databaseUrl });
  let child;
  let getOutput = () => "";
  try {
    await client.connect();
    await client.query("SELECT 1");
    console.log("ok - PostgreSQL is reachable");
    const ids = await createTestUsers(client);
    child = spawn(process.execPath, ["dist/main.js"], {
      cwd: apiDirectory,
      env: createEnvironment(),
      stdio: ["ignore", "pipe", "pipe"],
    });
    getOutput = createOutputBuffer(child);
    await waitForStartup(child, getOutput);
    const adminLogin = await login(adminEmail, adminPassword);
    const bidderLogin = await login(bidderEmail, bidderPassword);
    assert(adminLogin.statusCode === 201, "administrator login failed");
    assert(bidderLogin.statusCode === 201, "bidder login failed");
    const adminToken = adminLogin.body.accessToken;
    const bidderToken = bidderLogin.body.accessToken;

    await verifyAuthorization(adminToken, bidderToken);
    const createdAuction = await verifyCreation(adminToken, ids.adminId, client);
    await verifyListingAndDetails(adminToken, createdAuction);
    await verifyUpdates(adminToken, client, ids.adminId);
    await verifyConcurrentUpdate(adminToken, client);
    await verifyPublication(adminToken, client, ids.adminId);
    await verifyConcurrentPublication(adminToken, client);
    await verifyCancellation(adminToken, client, ids.adminId);
    await verifyBoundaryPhases(adminToken, client, ids.adminId);
    await terminateChild(child, getOutput);
    console.log("ok - auction admin integration verification passed");
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
    }
    await cleanup(client).catch(() => undefined);
    await client.end().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(sanitizeOutput(error instanceof Error ? error.stack ?? error.message : String(error)));
  process.exit(1);
});
