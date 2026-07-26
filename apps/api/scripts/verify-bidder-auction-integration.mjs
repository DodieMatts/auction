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
const port = 3104;
const runId = randomUUID();
const jwtSecret = randomBytes(32).toString("base64url");
const issuer = "bidder-auction-integration";
const audience = "bidder-auction-integration-web";
const adminEmail = `bidder-auctions-admin-${runId}@example.test`;
const bidderEmail = `bidder-auctions-bidder-${runId}@example.test`;
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

async function login(email, password) {
  return requestJson("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

async function bidderRequest(token, pathname) {
  return requestJson(pathname, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
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
    `Bidder Auction Test ${runId}%`,
  ]);
  await client.query('DELETE FROM "User" WHERE "email" = ANY($1)', [
    [adminEmail, bidderEmail],
  ]);
}

async function databaseNow(client) {
  const result = await client.query('SELECT CURRENT_TIMESTAMP AS "now"');
  const now = result.rows[0]?.now;
  assert(now instanceof Date, "database timestamp was not returned as a Date");
  return now;
}

function minutesFrom(anchor, minutes) {
  return new Date(anchor.getTime() + minutes * 60_000);
}

async function insertAuction(client, adminId, overrides = {}) {
  const id = overrides.id ?? randomUUID();
  createdAuctionIds.add(id);
  const status = overrides.status ?? "PUBLISHED";
  const title = overrides.title ?? `Bidder Auction Test ${runId}`;
  const startTime = overrides.startTime;
  const revealTime = overrides.revealTime;
  const endTime = overrides.endTime;
  await client.query(
    `
      INSERT INTO "Auction" (
        "id", "creationRequestId", "title", "description", "currency",
        "startTime", "revealTime", "endTime", "status", "createdById",
        "settledAt", "cancelledAt", "cancellationReason", "updatedAt"
      )
      VALUES ($1, $2, $3, $4, 'USD', $5, $6, $7, $8, $9, $10, $11, $12, NOW())
    `,
    [
      id,
      randomUUID(),
      title,
      overrides.description ?? "Temporary bidder auction integration record",
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

async function createFixtureAuctions(client, adminId) {
  const now = await databaseNow(client);
  const records = {};
  records.draft = await insertAuction(client, adminId, {
    title: `Bidder Auction Test ${runId} Draft`,
    status: "DRAFT",
    startTime: minutesFrom(now, 360),
    revealTime: minutesFrom(now, 420),
    endTime: minutesFrom(now, 480),
  });
  records.scheduled = await insertAuction(client, adminId, {
    title: `Bidder Auction Test ${runId} Scheduled`,
    startTime: minutesFrom(now, 360),
    revealTime: minutesFrom(now, 420),
    endTime: minutesFrom(now, 480),
  });
  records.commit = await insertAuction(client, adminId, {
    title: `Bidder Auction Test ${runId} Commit`,
    startTime: minutesFrom(now, -120),
    revealTime: minutesFrom(now, 120),
    endTime: minutesFrom(now, 240),
  });
  records.reveal = await insertAuction(client, adminId, {
    title: `Bidder Auction Test ${runId} Reveal`,
    startTime: minutesFrom(now, -240),
    revealTime: minutesFrom(now, -120),
    endTime: minutesFrom(now, 120),
  });
  records.ended = await insertAuction(client, adminId, {
    title: `Bidder Auction Test ${runId} Ended`,
    startTime: minutesFrom(now, -360),
    revealTime: minutesFrom(now, -240),
    endTime: minutesFrom(now, -120),
  });
  records.cancelled = await insertAuction(client, adminId, {
    title: `Bidder Auction Test ${runId} Cancelled`,
    status: "CANCELLED",
    startTime: minutesFrom(now, 360),
    revealTime: minutesFrom(now, 420),
    endTime: minutesFrom(now, 480),
    cancelledAt: now,
    cancellationReason: "Temporary hidden cancellation",
  });
  records.settled = await insertAuction(client, adminId, {
    title: `Bidder Auction Test ${runId} Settled`,
    status: "SETTLED",
    startTime: minutesFrom(now, -360),
    revealTime: minutesFrom(now, -240),
    endTime: minutesFrom(now, -120),
    settledAt: now,
  });

  for (let index = 0; index < 25; index += 1) {
    await insertAuction(client, adminId, {
      title: `Bidder Auction Test ${runId} Page ${String(index).padStart(2, "0")}`,
      startTime: minutesFrom(now, 600 + index),
      revealTime: minutesFrom(now, 700 + index),
      endTime: minutesFrom(now, 800 + index),
    });
  }

  return records;
}

function expectHiddenFieldsAbsent(value, context) {
  const serialized = JSON.stringify(value);
  const lower = serialized.toLowerCase();
  for (const field of [
    "createdById",
    "creationRequestId",
    "settlementRequestId",
    "cancellationRequestId",
    "cancellationReason",
    "version",
    "createdAt",
    "updatedAt",
    "settledAt",
    "cancelledAt",
    "bids",
    "commitments",
    "revealAttempts",
    "users",
    "passwordHash",
    "secret",
    "commitmentHash",
  ]) {
    assert(!lower.includes(field.toLowerCase()), `${context} exposed ${field}`);
  }
}

function expectAuctionShape(auction, context) {
  const keys = Object.keys(auction).sort();
  assert(
    JSON.stringify(keys) ===
      JSON.stringify([
        "currency",
        "description",
        "endTime",
        "id",
        "phase",
        "revealTime",
        "startTime",
        "status",
        "title",
      ]),
    `${context} returned unexpected auction fields: ${keys.join(", ")}`,
  );
  assert(!Number.isNaN(Date.parse(auction.startTime)), `${context} startTime is not ISO`);
  assert(!Number.isNaN(Date.parse(auction.revealTime)), `${context} revealTime is not ISO`);
  assert(!Number.isNaN(Date.parse(auction.endTime)), `${context} endTime is not ISO`);
}

function deriveExpectedPhase(auction, serverTime) {
  if (auction.status === "SETTLED") return "SETTLED";
  const now = Date.parse(serverTime);
  const start = Date.parse(auction.startTime);
  const reveal = Date.parse(auction.revealTime);
  const end = Date.parse(auction.endTime);
  if (now < start) return "SCHEDULED";
  if (now >= start && now < reveal) return "COMMIT";
  if (now >= reveal && now < end) return "REVEAL";
  return "ENDED";
}

function expectPhaseMatches(auction, serverTime, context) {
  assert(
    auction.phase === deriveExpectedPhase(auction, serverTime),
    `${context} phase mismatch: expected ${deriveExpectedPhase(auction, serverTime)}, got ${auction.phase}`,
  );
}

async function visibleTotal(client) {
  const result = await client.query(
    `SELECT COUNT(*)::int AS "total" FROM "Auction" WHERE "status" IN ('PUBLISHED', 'SETTLED')`,
  );
  return result.rows[0].total;
}

async function expectedVisibleOrder(client, limit, offset = 0) {
  const result = await client.query(
    `
      SELECT "id"
      FROM "Auction"
      WHERE "status" IN ('PUBLISHED', 'SETTLED')
      ORDER BY "startTime" DESC, "id" DESC
      LIMIT $1 OFFSET $2
    `,
    [limit, offset],
  );
  return result.rows.map((row) => row.id);
}

async function verifyAuthorization(adminToken, bidderToken, visibleId) {
  const missingList = await requestJson("/api/auctions", { method: "GET" });
  assert(missingList.statusCode === 401, "missing list authentication expected 401");
  const missingDetail = await requestJson(`/api/auctions/${visibleId}`, { method: "GET" });
  assert(missingDetail.statusCode === 401, "missing detail authentication expected 401");

  const invalidList = await requestJson("/api/auctions", {
    method: "GET",
    headers: { Authorization: "Bearer invalid-token" },
  });
  assert(invalidList.statusCode === 401, "invalid list authentication expected 401");
  const invalidDetail = await requestJson(`/api/auctions/${visibleId}`, {
    method: "GET",
    headers: { Authorization: "Bearer invalid-token" },
  });
  assert(invalidDetail.statusCode === 401, "invalid detail authentication expected 401");

  const adminList = await bidderRequest(adminToken, "/api/auctions");
  assert(adminList.statusCode === 403, "administrator list access expected 403");
  const adminDetail = await bidderRequest(adminToken, `/api/auctions/${visibleId}`);
  assert(adminDetail.statusCode === 403, "administrator detail access expected 403");

  const bidderList = await bidderRequest(bidderToken, "/api/auctions");
  assert(bidderList.statusCode === 200, "bidder list access expected 200");
  const bidderDetail = await bidderRequest(bidderToken, `/api/auctions/${visibleId}`);
  assert(bidderDetail.statusCode === 200, "bidder detail access expected 200");

  console.log("ok - bidder auction authorization passed");
}

async function verifyVisibilityAndDetails(bidderToken, records) {
  const list = await bidderRequest(bidderToken, "/api/auctions?limit=100");
  assert(list.statusCode === 200, `visible list expected 200, got ${list.statusCode}`);
  assert(!Number.isNaN(Date.parse(list.body.serverTime)), "list serverTime is not ISO");
  const ids = new Set(list.body.data.map((auction) => auction.id));
  for (const visibleId of [
    records.scheduled,
    records.commit,
    records.reveal,
    records.ended,
    records.settled,
  ]) {
    assert(ids.has(visibleId), `visible auction ${visibleId} missing from list`);
  }
  assert(!ids.has(records.draft), "draft auction appeared in bidder list");
  assert(!ids.has(records.cancelled), "cancelled auction appeared in bidder list");

  const draftDetail = await bidderRequest(bidderToken, `/api/auctions/${records.draft}`);
  const cancelledDetail = await bidderRequest(bidderToken, `/api/auctions/${records.cancelled}`);
  const unknownDetail = await bidderRequest(bidderToken, `/api/auctions/${randomUUID()}`);
  assert(draftDetail.statusCode === 404, "draft detail expected 404");
  assert(cancelledDetail.statusCode === 404, "cancelled detail expected 404");
  assert(unknownDetail.statusCode === 404, "unknown detail expected 404");
  assert(draftDetail.body.message === "Auction not found", "draft not-found message mismatch");
  assert(cancelledDetail.body.message === "Auction not found", "cancelled not-found message mismatch");
  assert(unknownDetail.body.message === "Auction not found", "unknown not-found message mismatch");

  const detail = await bidderRequest(bidderToken, `/api/auctions/${records.scheduled}`);
  assert(detail.statusCode === 200, "visible detail expected 200");
  expectAuctionShape(detail.body.auction, "detail response");
  expectHiddenFieldsAbsent(detail.body, "detail response");

  console.log("ok - bidder auction visibility and detail tests passed");
}

async function verifyPhases(bidderToken, records) {
  const list = await bidderRequest(bidderToken, "/api/auctions?limit=100");
  const serverTime = list.body.serverTime;
  assert(!Number.isNaN(Date.parse(serverTime)), "serverTime did not parse");
  const byId = new Map(list.body.data.map((auction) => [auction.id, auction]));

  for (const [id, phase] of [
    [records.scheduled, "SCHEDULED"],
    [records.commit, "COMMIT"],
    [records.reveal, "REVEAL"],
    [records.ended, "ENDED"],
    [records.settled, "SETTLED"],
  ]) {
    const auction = byId.get(id);
    assert(auction, `phase test auction ${id} missing`);
    assert(auction.phase === phase, `expected phase ${phase}, got ${auction.phase}`);
    expectPhaseMatches(auction, serverTime, `phase test ${phase}`);
  }

  console.log("ok - bidder auction phase tests passed");
}

async function verifyResponseSafety(bidderToken, records) {
  const list = await bidderRequest(bidderToken, "/api/auctions?limit=100");
  expectHiddenFieldsAbsent(list.body, "list response");
  for (const auction of list.body.data) {
    expectAuctionShape(auction, "list item");
    expectPhaseMatches(auction, list.body.serverTime, "list item");
  }

  const detail = await bidderRequest(bidderToken, `/api/auctions/${records.commit}`);
  expectHiddenFieldsAbsent(detail.body, "detail response");
  expectAuctionShape(detail.body.auction, "detail response");
  expectPhaseMatches(detail.body.auction, detail.body.serverTime, "detail response");

  console.log("ok - bidder auction response safety passed");
}

async function verifyPagination(bidderToken, client) {
  const total = await visibleTotal(client);
  const defaultList = await bidderRequest(bidderToken, "/api/auctions");
  assert(defaultList.statusCode === 200, "default pagination expected 200");
  assert(defaultList.body.pagination.page === 1, "default page mismatch");
  assert(defaultList.body.pagination.limit === 20, "default limit mismatch");
  assert(defaultList.body.pagination.total === total, "default total mismatch");
  assert(
    defaultList.body.pagination.totalPages === Math.ceil(total / 20),
    "default totalPages mismatch",
  );

  const pageTwo = await bidderRequest(bidderToken, "/api/auctions?page=2&limit=5");
  assert(pageTwo.statusCode === 200, "custom pagination expected 200");
  assert(pageTwo.body.pagination.page === 2, "custom page mismatch");
  assert(pageTwo.body.pagination.limit === 5, "custom limit mismatch");
  assert(pageTwo.body.pagination.total === total, "custom total mismatch");
  assert(pageTwo.body.pagination.totalPages === Math.ceil(total / 5), "custom totalPages mismatch");

  const expectedFirstIds = await expectedVisibleOrder(client, 10);
  const ordered = await bidderRequest(bidderToken, "/api/auctions?page=1&limit=10");
  assert(
    JSON.stringify(ordered.body.data.map((auction) => auction.id)) === JSON.stringify(expectedFirstIds),
    "visible auction ordering mismatch",
  );

  const empty = await bidderRequest(bidderToken, "/api/auctions?page=100000&limit=100");
  assert(empty.statusCode === 200, "empty page expected 200");
  assert(Array.isArray(empty.body.data) && empty.body.data.length === 0, "empty page was not empty");

  for (const path of [
    "/api/auctions?page=0",
    "/api/auctions?page=abc",
    "/api/auctions?limit=0",
    "/api/auctions?limit=101",
    "/api/auctions?unexpected=1",
  ]) {
    const response = await bidderRequest(bidderToken, path);
    assert(response.statusCode === 400, `${path} expected 400`);
  }

  console.log("ok - bidder auction pagination tests passed");
}

function verifyServiceQuerySafety() {
  const source = readFileSync(resolve(apiDirectory, "src/auctions/bidder-auctions.service.ts"), "utf8");
  assert(source.includes("select: bidderAuctionSelect"), "bidder service does not use narrow select");
  assert(!source.includes("include:"), "bidder service should not load relations");
  assert(!source.includes("$queryRaw"), "bidder service should not use raw SQL for auction lookup");
  for (const field of [
    "createdById",
    "creationRequestId",
    "settlementRequestId",
    "cancellationRequestId",
    "cancellationReason",
    "version",
    "createdAt",
    "updatedAt",
    "settledAt",
    "cancelledAt",
  ]) {
    assert(!source.includes(`${field}: true`), `bidder service selects hidden field ${field}`);
  }

  console.log("ok - bidder auction query safety passed");
}

async function main() {
  assert(databaseUrl, "DATABASE_URL is required");

  let child = null;
  let getOutput = () => "";
  let databaseConnected = false;
  const client = new Client({ connectionString: databaseUrl });

  try {
    await runCommand("npm", ["run", "build"]);
    console.log("ok - NestJS application builds");

    await client.connect();
    databaseConnected = true;
    await client.query("SELECT 1");
    console.log("ok - PostgreSQL is reachable");

    const { adminId } = await createTestUsers(client);
    const records = await createFixtureAuctions(client, adminId);

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

    await verifyAuthorization(adminToken, bidderToken, records.scheduled);
    await verifyVisibilityAndDetails(bidderToken, records);
    await verifyPhases(bidderToken, records);
    await verifyResponseSafety(bidderToken, records);
    await verifyPagination(bidderToken, client);
    verifyServiceQuerySafety();

    console.log("ok - bidder auction integration verification passed");
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
