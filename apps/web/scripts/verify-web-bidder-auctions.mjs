import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import net from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import argon2 from "argon2";
import pg from "pg";

const { Client } = pg;

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const webDirectory = resolve(scriptDirectory, "..");
const apiDirectory = resolve(webDirectory, "../api");
const rootDirectory = resolve(webDirectory, "../..");
const apiEnvPath = resolve(apiDirectory, ".env");
const host = "127.0.0.1";
const webPort = 3115;
const apiPort = 3116;
const webOrigin = `http://${host}:${webPort}`;
const apiBaseUrl = `http://${host}:${apiPort}/api`;
const startupTimeoutMs = 20_000;
const npmCliPath =
  process.env.npm_execpath ?? "/usr/local/lib/node_modules/npm/bin/npm-cli.js";
const jwtSecret = randomBytes(32).toString("base64url");
const runId = randomUUID();
const adminId = randomUUID();
const bidderId = randomUUID();
const otherBidderId = randomUUID();
const adminEmail = `web-bidder-admin-${runId}@example.test`;
const bidderEmail = `web-bidder-${runId}@example.test`;
const otherBidderEmail = `web-bidder-other-${runId}@example.test`;
const adminPassword = "WebBidderAdmin123!";
const bidderPassword = "WebBidderBidder123!";
const otherBidderPassword = "WebBidderOther123!";
const tempUserIds = [adminId, bidderId, otherBidderId];
const tempAuctionIds = new Set();
const tempBidIds = new Set();
const tempCommitmentIds = new Set();
const tempRevealIds = new Set();
const sensitiveValues = new Set([
  jwtSecret,
  adminPassword,
  bidderPassword,
  otherBidderPassword,
]);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function wait(ms) {
  return new Promise((resolveWait) => setTimeout(resolveWait, ms));
}

function parseEnvFile(path) {
  if (!existsSync(path)) return {};
  return Object.fromEntries(
    readFileSync(path, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
      .map((line) => {
        const separator = line.indexOf("=");
        const key = line.slice(0, separator).trim();
        let value = line.slice(separator + 1).trim();
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

const apiFileEnv = parseEnvFile(apiEnvPath);
const databaseUrl = process.env.DATABASE_URL ?? apiFileEnv.DATABASE_URL;
if (databaseUrl) sensitiveValues.add(databaseUrl);

function sanitizeOutput(output) {
  let sanitized = output;
  for (const value of sensitiveValues) {
    if (value) sanitized = sanitized.split(value).join("[REDACTED]");
  }
  return sanitized
    .replaceAll(/postgres(?:ql)?:\/\/[^\s'"]+/g, "[REDACTED_DATABASE_URL]")
    .replaceAll(/eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g, "[REDACTED_TOKEN]");
}

function createOutputBuffer(child) {
  const chunks = [];
  child.stdout.on("data", (chunk) => chunks.push(chunk));
  child.stderr.on("data", (chunk) => chunks.push(chunk));
  return {
    raw: () => Buffer.concat(chunks).toString("utf8"),
    sanitized: () => sanitizeOutput(Buffer.concat(chunks).toString("utf8")),
  };
}

function createApiEnvironment() {
  return {
    ...process.env,
    ...apiFileEnv,
    NODE_ENV: "test",
    HOST: host,
    PORT: String(apiPort),
    JWT_ACCESS_SECRET: jwtSecret,
    JWT_ACCESS_TTL_SECONDS: "900",
    JWT_ISSUER: "auction-api",
    JWT_AUDIENCE: "auction-web",
  };
}

function createWebEnvironment() {
  return {
    ...process.env,
    NODE_ENV: "production",
    API_BASE_URL: apiBaseUrl,
    HOSTNAME: host,
    PORT: String(webPort),
  };
}

async function assertTcpReachable(urlString) {
  const url = new URL(urlString);
  const port = Number.parseInt(url.port || "5432", 10);
  await new Promise((resolveReachable, rejectReachable) => {
    const socket = net.createConnection({ host: url.hostname, port });
    socket.setTimeout(5000);
    socket.once("connect", () => {
      socket.destroy();
      resolveReachable();
    });
    socket.once("timeout", () => {
      socket.destroy();
      rejectReachable(new Error("PostgreSQL TCP endpoint timed out"));
    });
    socket.once("error", rejectReachable);
  });
}

async function runCommand(command, args, options = {}) {
  return new Promise((resolveCommand, rejectCommand) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? rootDirectory,
      env: options.env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const output = createOutputBuffer(child);
    child.once("error", rejectCommand);
    child.once("close", (code, signal) => {
      if (code === 0) {
        resolveCommand();
        return;
      }
      rejectCommand(
        new Error(
          `${command} ${args.join(" ")} failed with code ${code ?? "null"} signal ${signal ?? "null"}\n${output.sanitized()}`,
        ),
      );
    });
  });
}

function startProcess(command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: options.cwd ?? rootDirectory,
    env: options.env ?? process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return { child, output: createOutputBuffer(child) };
}

async function terminateChild(child, output, name) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  const result = await Promise.race([once(child, "close"), wait(5000)]);
  if (!Array.isArray(result)) {
    child.kill("SIGKILL");
    throw new Error(`${name} did not terminate cleanly\n${output.sanitized()}`);
  }
}

async function waitForHttp(path, port, output, name) {
  const deadline = Date.now() + startupTimeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://${host}:${port}${path}`, {
        redirect: "manual",
      });
      if (response.status < 500) return;
    } catch (error) {
      lastError = error;
    }
    await wait(250);
  }
  throw new Error(
    `${name} did not start: ${lastError instanceof Error ? lastError.message : "timeout"}\n${output.sanitized()}`,
  );
}

async function webRequest(path, options = {}) {
  const response = await fetch(`${webOrigin}${path}`, {
    redirect: options.redirect ?? "manual",
    method: options.method ?? "GET",
    headers: options.headers,
    body: options.body,
  });
  const text = await response.text();
  return {
    response,
    text,
    json: () => (text ? JSON.parse(text) : null),
    cookie: response.headers.get("set-cookie") ?? "",
  };
}

async function login(email, password) {
  const result = await webRequest("/api/auth/login", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: webOrigin,
    },
    body: JSON.stringify({ email, password }),
  });
  assert(result.response.status === 200, `login failed for ${email}`);
  const cookie = extractCookie(result.cookie);
  assert(cookie.includes("auction_session="), "login did not set session cookie");
  assert(!result.text.includes("accessToken"), "login response exposed token field");
  return { cookie };
}

function extractCookie(setCookieHeader) {
  return setCookieHeader
    .split(/,(?=\s*auction_session=)/)
    .map((value) => value.trim())
    .find((value) => value.startsWith("auction_session="))
    ?.split(";")[0] ?? "";
}

async function createTemporaryUsers(client) {
  const [adminHash, bidderHash, otherBidderHash] = await Promise.all([
    argon2.hash(adminPassword, { type: argon2.argon2id }),
    argon2.hash(bidderPassword, { type: argon2.argon2id }),
    argon2.hash(otherBidderPassword, { type: argon2.argon2id }),
  ]);
  await client.query(
    `INSERT INTO "User" ("id", "email", "passwordHash", "role", "status", "updatedAt")
     VALUES ($1, $2, $3, 'ADMIN', 'ACTIVE', CURRENT_TIMESTAMP),
            ($4, $5, $6, 'BIDDER', 'ACTIVE', CURRENT_TIMESTAMP),
            ($7, $8, $9, 'BIDDER', 'ACTIVE', CURRENT_TIMESTAMP)`,
    [
      adminId,
      adminEmail,
      adminHash,
      bidderId,
      bidderEmail,
      bidderHash,
      otherBidderId,
      otherBidderEmail,
      otherBidderHash,
    ],
  );
}

async function createAuction(client, input) {
  const id = input.id ?? randomUUID();
  tempAuctionIds.add(id);
  const now = Date.now();
  const startTime = input.startTime ?? new Date(now + 60 * 60_000);
  const revealTime = input.revealTime ?? new Date(now + 120 * 60_000);
  const endTime = input.endTime ?? new Date(now + 180 * 60_000);
  await client.query(
    `INSERT INTO "Auction"
      ("id", "creationRequestId", "title", "description", "currency", "startTime",
       "revealTime", "endTime", "status", "createdById", "version", "settledAt",
       "cancelledAt", "cancellationRequestId", "cancellationReason", "updatedAt")
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, CURRENT_TIMESTAMP)`,
    [
      id,
      randomUUID(),
      input.title,
      input.description ?? null,
      input.currency ?? "USD",
      startTime,
      revealTime,
      endTime,
      input.status,
      adminId,
      input.version ?? 0,
      input.settledAt ?? null,
      input.status === "CANCELLED" ? (input.cancelledAt ?? new Date()) : null,
      input.status === "CANCELLED" ? randomUUID() : null,
      input.status === "CANCELLED" ? "Temporary cancellation" : null,
    ],
  );
  return id;
}

async function createBidWithCommitment(client, commitmentTools, input) {
  const bidId = input.bidId ?? randomUUID();
  const commitmentId = input.commitmentId ?? randomUUID();
  const secret = input.secret ?? (await commitmentTools.generateBidSecretV1());
  const amountCents = input.amountCents ?? "12500";
  const commitmentHash =
    input.commitmentHash ??
    (await commitmentTools.computeBidCommitmentV1({
      auctionId: input.auctionId,
      bidderId: input.bidderId,
      currency: input.currency ?? "USD",
      amountCents,
      secret,
    }));
  tempBidIds.add(bidId);
  tempCommitmentIds.add(commitmentId);
  sensitiveValues.add(secret);
  sensitiveValues.add(commitmentHash);
  await client.query(
    `INSERT INTO "Bid" ("id", "auctionId", "bidderId", "status", "version", "updatedAt")
     VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)`,
    [bidId, input.auctionId, input.bidderId, input.status ?? "COMMITTED", input.version ?? 1],
  );
  await client.query(
    `INSERT INTO "BidCommitment"
      ("id", "bidId", "clientRequestId", "commitmentHash", "protocolVersion", "isCurrent", "committedAt")
     VALUES ($1, $2, $3, $4, 1, true, $5)`,
    [commitmentId, bidId, randomUUID(), commitmentHash, input.committedAt ?? new Date()],
  );
  return { bidId, commitmentId, secret, amountCents, commitmentHash };
}

async function createReveal(client, input) {
  const revealId = randomUUID();
  tempRevealIds.add(revealId);
  if (input.secret) sensitiveValues.add(input.secret);
  await client.query(
    `INSERT INTO "BidRevealAttempt"
      ("id", "bidId", "clientRequestId", "amountCents", "secret", "validationStatus", "invalidReason", "submittedAt")
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      revealId,
      input.bidId,
      randomUUID(),
      input.amountCents,
      input.secret ?? "audited-placeholder",
      input.validationStatus,
      input.invalidReason ?? null,
      input.submittedAt ?? new Date(),
    ],
  );
  return revealId;
}

async function cleanupTemporaryData(client) {
  const revealIds = [...tempRevealIds];
  const commitmentIds = [...tempCommitmentIds];
  const bidIds = [...tempBidIds];
  const auctionIds = [...tempAuctionIds];
  if (revealIds.length) await client.query(`DELETE FROM "BidRevealAttempt" WHERE "id" = ANY($1::uuid[])`, [revealIds]);
  if (commitmentIds.length) await client.query(`DELETE FROM "BidCommitment" WHERE "id" = ANY($1::uuid[])`, [commitmentIds]);
  if (bidIds.length) await client.query(`DELETE FROM "Bid" WHERE "id" = ANY($1::uuid[])`, [bidIds]);
  if (auctionIds.length) await client.query(`DELETE FROM "Auction" WHERE "id" = ANY($1::uuid[])`, [auctionIds]);
  await client.query(`DELETE FROM "User" WHERE "id" = ANY($1::uuid[])`, [tempUserIds]);
}

async function cleanupStaleVerificationData(client) {
  const users = await client.query(
    `SELECT "id" FROM "User" WHERE "email" LIKE 'web-bidder-%@example.test'`,
  );
  const userIds = users.rows.map((row) => row.id);
  if (userIds.length === 0) return;

  const auctions = await client.query(
    `SELECT "id" FROM "Auction" WHERE "createdById" = ANY($1::uuid[])`,
    [userIds],
  );
  const auctionIds = auctions.rows.map((row) => row.id);
  const bids = await client.query(
    `SELECT "id" FROM "Bid"
     WHERE "bidderId" = ANY($1::uuid[])
        OR (${auctionIds.length > 0 ? `"auctionId" = ANY($2::uuid[])` : "false"})`,
    auctionIds.length > 0 ? [userIds, auctionIds] : [userIds],
  );
  const bidIds = bids.rows.map((row) => row.id);
  if (bidIds.length) {
    await client.query(`DELETE FROM "BidRevealAttempt" WHERE "bidId" = ANY($1::uuid[])`, [bidIds]);
    await client.query(`DELETE FROM "BidCommitment" WHERE "bidId" = ANY($1::uuid[])`, [bidIds]);
    await client.query(`DELETE FROM "Bid" WHERE "id" = ANY($1::uuid[])`, [bidIds]);
  }
  if (auctionIds.length) {
    await client.query(`DELETE FROM "Auction" WHERE "id" = ANY($1::uuid[])`, [auctionIds]);
  }
  await client.query(`DELETE FROM "User" WHERE "id" = ANY($1::uuid[])`, [userIds]);
}

async function runAuthorizationAndListingTests(client, bidderCookie, adminCookie) {
  const hiddenDraftId = await createAuction(client, {
    title: `Hidden draft ${runId}`,
    status: "DRAFT",
  });
  const hiddenCancelledId = await createAuction(client, {
    title: `Hidden cancelled ${runId}`,
    status: "CANCELLED",
  });
  const visibleId = await createAuction(client, {
    title: `Visible scheduled ${runId}`,
    status: "PUBLISHED",
  });
  const settledId = await createAuction(client, {
    title: `Visible settled ${runId}`,
    status: "SETTLED",
    settledAt: new Date(),
  });

  const unauthenticated = await webRequest("/auctions");
  assert([307, 308].includes(unauthenticated.response.status), "unauthenticated bidder page did not redirect");

  const adminPage = await webRequest("/auctions", { headers: { Cookie: adminCookie } });
  assert(
    [200, 307, 308].includes(adminPage.response.status),
    "administrator bidder page returned an unexpected status",
  );
  if (adminPage.response.status === 200) {
    assert(!adminPage.text.includes("Available auctions"), "administrator rendered bidder content");
  }

  const listing = await webRequest("/auctions", { headers: { Cookie: bidderCookie } });
  assert(listing.response.status === 200, "bidder listing did not render");
  assert(listing.text.includes(`Visible scheduled ${runId}`), "visible auction missing");
  assert(listing.text.includes(`Visible settled ${runId}`), "settled auction missing");
  assert(!listing.text.includes(`Hidden draft ${runId}`), "draft auction leaked into listing");
  assert(!listing.text.includes(`Hidden cancelled ${runId}`), "cancelled auction leaked into listing");
  assert(listing.text.includes(bidderEmail), "bidder email missing from dashboard header");
  assert(!listing.text.includes(bidderId), "bidder identifier rendered visibly");

  const detail = await webRequest(`/auctions/${visibleId}`, { headers: { Cookie: bidderCookie } });
  assert(detail.response.status === 200, "bidder detail did not render");
  assert(detail.text.includes("Schedule and phase"), "detail metadata missing");
  assert(detail.text.includes("Server-timed window"), "countdown markup missing");
  assert(detail.text.includes("Your participation"), "participation state missing");

  const draftDetail = await webRequest(`/api/auctions/${hiddenDraftId}`, { headers: { Cookie: bidderCookie } });
  const cancelledDetail = await webRequest(`/api/auctions/${hiddenCancelledId}`, { headers: { Cookie: bidderCookie } });
  assert(draftDetail.response.status === 404, "draft detail did not stay hidden");
  assert(cancelledDetail.response.status === 404, "cancelled detail did not stay hidden");
  assert((await draftDetail.json()).message === (await cancelledDetail.json()).message, "hidden detail messages differ");

  const adminApi = await webRequest("/api/auctions", { headers: { Cookie: adminCookie } });
  assert(adminApi.response.status === 403, "administrator API access was not forbidden");

  return { visibleId, settledId };
}

async function runCommitmentTests(client, commitmentTools, bidderCookie) {
  const now = Date.now();
  const auctionId = await createAuction(client, {
    title: `Commit UI ${runId}`,
    status: "PUBLISHED",
    startTime: new Date(now - 60_000),
    revealTime: new Date(now + 60 * 60_000),
    endTime: new Date(now + 120 * 60_000),
  });
  const amountCents = "12500";
  const secret = await commitmentTools.generateBidSecretV1();
  const commitmentHash = await commitmentTools.computeBidCommitmentV1({
    auctionId,
    bidderId,
    currency: "USD",
    amountCents,
    secret,
  });
  sensitiveValues.add(secret);
  sensitiveValues.add(commitmentHash);
  const response = await postJson(
    `/api/auctions/${auctionId}/commitments`,
    bidderCookie,
    {
      clientRequestId: randomUUID(),
      commitmentHash,
      protocolVersion: 1,
    },
  );
  assert(
    response.response.status === 201,
    `first commitment failed with ${response.response.status}: ${response.text}`,
  );
  assertNoLeakage(response.text, [amountCents, secret, commitmentHash], "commitment response");
  const payload = response.json();
  assert(payload.bid.version === 1, "first commitment version mismatch");
  assert(payload.replacedPreviousCommitment === false, "first commitment replacement flag wrong");

  const rows = await client.query(
    `SELECT b."id", b."version", COUNT(c."id")::int AS "commitmentCount"
     FROM "Bid" b JOIN "BidCommitment" c ON c."bidId" = b."id"
     WHERE b."auctionId" = $1 AND b."bidderId" = $2
     GROUP BY b."id", b."version"`,
    [auctionId, bidderId],
  );
  assert(rows.rowCount === 1, "logical bid was not created once");
  tempBidIds.add(rows.rows[0].id);
  const commitmentRows = await client.query(`SELECT "id" FROM "BidCommitment" WHERE "bidId" = $1`, [rows.rows[0].id]);
  for (const row of commitmentRows.rows) tempCommitmentIds.add(row.id);

  const replacementSecret = await commitmentTools.generateBidSecretV1();
  const replacementHash = await commitmentTools.computeBidCommitmentV1({
    auctionId,
    bidderId,
    currency: "USD",
    amountCents: "13500",
    secret: replacementSecret,
  });
  sensitiveValues.add(replacementSecret);
  sensitiveValues.add(replacementHash);
  const replacement = await postJson(
    `/api/auctions/${auctionId}/commitments`,
    bidderCookie,
    {
      clientRequestId: randomUUID(),
      commitmentHash: replacementHash,
      protocolVersion: 1,
      expectedBidVersion: payload.bid.version,
    },
  );
  assert(
    replacement.response.status === 201,
    `replacement commitment failed with ${replacement.response.status}: ${replacement.text}`,
  );
  assert(replacement.json().replacedPreviousCommitment === true, "replacement flag missing");
  assertNoLeakage(replacement.text, ["13500", replacementSecret, replacementHash], "replacement response");

  const current = await client.query(
    `SELECT b."version", COUNT(*) FILTER (WHERE c."isCurrent")::int AS "currentCount",
            COUNT(*)::int AS "historyCount"
     FROM "Bid" b JOIN "BidCommitment" c ON c."bidId" = b."id"
     WHERE b."auctionId" = $1 AND b."bidderId" = $2
     GROUP BY b."version"`,
    [auctionId, bidderId],
  );
  assert(current.rows[0].version === 2, "replacement did not increment bid version");
  assert(current.rows[0].currentCount === 1, "replacement left wrong current count");
  assert(current.rows[0].historyCount === 2, "replacement did not preserve history");
  console.log("ok - bidder commitment workflow passed");
}

async function runRevealTests(client, commitmentTools, bidderCookie) {
  const now = Date.now();
  const auctionId = await createAuction(client, {
    title: `Reveal UI ${runId}`,
    status: "PUBLISHED",
    startTime: new Date(now - 120 * 60_000),
    revealTime: new Date(now - 60_000),
    endTime: new Date(now + 60 * 60_000),
  });
  const bid = await createBidWithCommitment(client, commitmentTools, {
    auctionId,
    bidderId,
    amountCents: "15000",
    currency: "USD",
  });
  const validReveal = await postJson(`/api/auctions/${auctionId}/reveals`, bidderCookie, {
    clientRequestId: randomUUID(),
    amountCents: bid.amountCents,
    secret: bid.secret,
    expectedBidVersion: 1,
  });
  assert(
    validReveal.response.status === 201,
    `valid reveal failed with ${validReveal.response.status}: ${validReveal.text}`,
  );
  assert(validReveal.json().bid.status === "REVEALED", "valid reveal did not update bid");
  assertNoLeakage(validReveal.text, [bid.secret, bid.commitmentHash], "valid reveal response");
  const revealRows = await client.query(`SELECT "id" FROM "BidRevealAttempt" WHERE "bidId" = $1`, [bid.bidId]);
  for (const row of revealRows.rows) tempRevealIds.add(row.id);

  const invalidAuctionId = await createAuction(client, {
    title: `Invalid reveal UI ${runId}`,
    status: "PUBLISHED",
    startTime: new Date(now - 120 * 60_000),
    revealTime: new Date(now - 60_000),
    endTime: new Date(now + 60 * 60_000),
  });
  const invalidBid = await createBidWithCommitment(client, commitmentTools, {
    auctionId: invalidAuctionId,
    bidderId,
    amountCents: "16000",
    currency: "USD",
  });
  const badSecret = await commitmentTools.generateBidSecretV1();
  sensitiveValues.add(badSecret);
  const invalidReveal = await postJson(`/api/auctions/${invalidAuctionId}/reveals`, bidderCookie, {
    clientRequestId: randomUUID(),
    amountCents: invalidBid.amountCents,
    secret: badSecret,
    expectedBidVersion: 1,
  });
  assert(
    invalidReveal.response.status === 422,
    `invalid reveal returned ${invalidReveal.response.status}: ${invalidReveal.text}`,
  );
  assertNoLeakage(invalidReveal.text, [badSecret, invalidBid.commitmentHash, invalidBid.amountCents], "invalid reveal response");
  const invalidRevealRows = await client.query(`SELECT "id" FROM "BidRevealAttempt" WHERE "bidId" = $1`, [invalidBid.bidId]);
  for (const row of invalidRevealRows.rows) tempRevealIds.add(row.id);
  console.log("ok - bidder reveal workflow passed");
}

async function runResultTests(client, commitmentTools, bidderCookie) {
  const now = Date.now();
  const auctionId = await createAuction(client, {
    title: `Settled result UI ${runId}`,
    status: "SETTLED",
    startTime: new Date(now - 180 * 60_000),
    revealTime: new Date(now - 120 * 60_000),
    endTime: new Date(now - 60 * 60_000),
    settledAt: new Date(now - 30 * 60_000),
    version: 3,
  });
  const winner = await createBidWithCommitment(client, commitmentTools, {
    auctionId,
    bidderId,
    amountCents: "20000",
    status: "WON",
    version: 2,
    currency: "USD",
  });
  const loser = await createBidWithCommitment(client, commitmentTools, {
    auctionId,
    bidderId: otherBidderId,
    amountCents: "17777",
    status: "LOST",
    version: 2,
    currency: "USD",
  });
  await createReveal(client, {
    bidId: winner.bidId,
    amountCents: winner.amountCents,
    secret: winner.secret,
    validationStatus: "VALID",
  });
  await createReveal(client, {
    bidId: loser.bidId,
    amountCents: loser.amountCents,
    secret: loser.secret,
    validationStatus: "VALID",
  });
  const apiResult = await webRequest(`/api/auctions/${auctionId}/results`, {
    headers: { Cookie: bidderCookie },
  });
  assert(apiResult.response.status === 200, "bidder result API failed");
  assert(apiResult.text.includes("20000"), "winning amount missing");
  assert(apiResult.text.includes('"WON"'), "personal winner outcome missing");
  assertNoLeakage(apiResult.text, [otherBidderId, otherBidderEmail, loser.amountCents, winner.secret, loser.secret, winner.commitmentHash, loser.commitmentHash], "result API");

  const page = await webRequest(`/auctions/${auctionId}`, { headers: { Cookie: bidderCookie } });
  assert(page.response.status === 200, "settled detail page failed");
  assert(page.text.includes("Final outcome"), "settled result summary missing");
  assert(page.text.includes("$200.00"), "winning amount missing from page");
  assertNoLeakage(page.text, [otherBidderId, otherBidderEmail, loser.amountCents, winner.secret, loser.secret, winner.commitmentHash, loser.commitmentHash], "result page");
  console.log("ok - bidder results workflow passed");
}

async function postJson(path, cookie, body) {
  return webRequest(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: webOrigin,
      Cookie: cookie,
    },
    body: JSON.stringify(body),
  });
}

function assertNoLeakage(text, values, context) {
  for (const value of values) {
    if (value) assert(!text.includes(String(value)), `${context} leaked sensitive value`);
  }
  for (const forbidden of ["accessToken", "passwordHash", "clientRequestId"]) {
    assert(!text.includes(forbidden), `${context} leaked ${forbidden}`);
  }
}

function readFilesRecursively(directory) {
  if (!existsSync(directory)) return [];
  const files = [];
  for (const entry of readdirSync(directory)) {
    const path = resolve(directory, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) files.push(...readFilesRecursively(path));
    else if (stat.isFile()) files.push(path);
  }
  return files;
}

function runStaticLeakageChecks(outputs) {
  const staticFiles = readFilesRecursively(resolve(webDirectory, ".next/static"));
  const browserDelivered = staticFiles.map((file) => readFileSync(file, "utf8")).join("\n");
  assert(!browserDelivered.includes("localStorage"), "browser bundle references localStorage");
  assert(!browserDelivered.includes("sessionStorage"), "browser bundle references sessionStorage");
  assert(!browserDelivered.includes("IndexedDB"), "browser bundle references IndexedDB");
  assert(!browserDelivered.includes("document.cookie"), "browser bundle references document.cookie");
  assert(!browserDelivered.includes(apiBaseUrl), "browser bundle exposed backend URL");
  for (const output of outputs) {
    const raw = output.raw();
    for (const value of sensitiveValues) {
      if (value) assert(!raw.includes(value), "application output leaked sensitive value");
    }
  }
  console.log("ok - bidder browser leakage checks passed");
}

async function main() {
  assert(databaseUrl, "DATABASE_URL is required for bidder auction verification");
  await assertTcpReachable(databaseUrl);
  console.log("ok - PostgreSQL TCP endpoint is reachable");

  await runCommand(process.execPath, [npmCliPath, "run", "build", "--workspace", "@auction/commitment"]);
  console.log("ok - shared commitment package builds");
  const commitmentTools = await import("@auction/commitment");

  await runCommand(process.execPath, [npmCliPath, "run", "build", "--workspace", "apps/api"], {
    cwd: rootDirectory,
    env: createApiEnvironment(),
  });
  console.log("ok - NestJS application builds");

  await runCommand(process.execPath, [npmCliPath, "run", "build", "--workspace", "@auction/web"], {
    cwd: rootDirectory,
    env: createWebEnvironment(),
  });
  console.log("ok - Next.js application builds");

  const client = new Client({ connectionString: databaseUrl });
  let apiProcess = null;
  let webProcess = null;

  try {
    await client.connect();
    await cleanupStaleVerificationData(client);
    await createTemporaryUsers(client);
    console.log("ok - temporary bidder verification users created");

    apiProcess = startProcess("node", ["dist/main.js"], {
      cwd: apiDirectory,
      env: createApiEnvironment(),
    });
    await waitForHttp("/api/health/live", apiPort, apiProcess.output, "API");
    console.log("ok - API started");

    webProcess = startProcess(
      process.execPath,
      [npmCliPath, "run", "start", "--workspace", "@auction/web", "--", "-H", host, "-p", String(webPort)],
      { cwd: rootDirectory, env: createWebEnvironment() },
    );
    await waitForHttp("/", webPort, webProcess.output, "frontend");
    console.log("ok - frontend started");

    const adminLogin = await login(adminEmail, adminPassword);
    const bidderLogin = await login(bidderEmail, bidderPassword);

    await runAuthorizationAndListingTests(client, bidderLogin.cookie, adminLogin.cookie);
    await runCommitmentTests(client, commitmentTools, bidderLogin.cookie);
    await runRevealTests(client, commitmentTools, bidderLogin.cookie);
    await runResultTests(client, commitmentTools, bidderLogin.cookie);
    runStaticLeakageChecks([apiProcess.output, webProcess.output]);
  } finally {
    if (client._connected) {
      await cleanupTemporaryData(client).catch(() => undefined);
      await client.end().catch(() => undefined);
    }
    if (webProcess) await terminateChild(webProcess.child, webProcess.output, "frontend");
    if (apiProcess) await terminateChild(apiProcess.child, apiProcess.output, "API");
  }

  console.log("ok - web bidder auction verification passed");
}

main().catch((error) => {
  console.error(sanitizeOutput(error instanceof Error ? error.message : String(error)));
  process.exitCode = 1;
});
