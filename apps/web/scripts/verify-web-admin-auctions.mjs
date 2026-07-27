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
const webPort = 3113;
const apiPort = 3114;
const webOrigin = `http://${host}:${webPort}`;
const apiBaseUrl = `http://${host}:${apiPort}/api`;
const startupTimeoutMs = 20_000;
const npmCliPath =
  process.env.npm_execpath ?? "/usr/local/lib/node_modules/npm/bin/npm-cli.js";
const jwtSecret = randomBytes(32).toString("base64url");
const runId = randomUUID();
const adminId = randomUUID();
const bidderId = randomUUID();
const loserId = randomUUID();
const adminEmail = `web-admin-auctions-admin-${runId}@example.test`;
const bidderEmail = `web-admin-auctions-bidder-${runId}@example.test`;
const loserEmail = `web-admin-auctions-loser-${runId}@example.test`;
const adminPassword = "WebAdminAuctionsAdmin123!";
const bidderPassword = "WebAdminAuctionsBidder123!";
const loserPassword = "WebAdminAuctionsLoser123!";
const tempUserIds = [adminId, bidderId, loserId];
const tempAuctionIds = new Set();
const tempBidIds = new Set();
const tempCommitmentIds = new Set();
const tempRevealIds = new Set();
const sensitiveValues = new Set([
  jwtSecret,
  adminPassword,
  bidderPassword,
  loserPassword,
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
    throw new Error(`${name} did not terminate after SIGTERM\n${output.sanitized()}`);
  }
}

async function waitForHttp(pathname, port, output, name) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < startupTimeoutMs) {
    try {
      const response = await fetch(`http://${host}:${port}${pathname}`, {
        cache: "no-store",
        redirect: "manual",
      });
      if (response.status < 500) return;
    } catch {
      await wait(150);
    }
  }
  throw new Error(`${name} did not start within ${startupTimeoutMs}ms\n${output.sanitized()}`);
}

async function createTemporaryUsers(client) {
  for (const user of [
    { id: adminId, email: adminEmail, password: adminPassword, role: "ADMIN" },
    { id: bidderId, email: bidderEmail, password: bidderPassword, role: "BIDDER" },
    { id: loserId, email: loserEmail, password: loserPassword, role: "BIDDER" },
  ]) {
    const passwordHash = await argon2.hash(user.password, { type: argon2.argon2id });
    await client.query(
      `
        INSERT INTO "User" (
          "id", "email", "passwordHash", "role", "status", "createdAt", "updatedAt"
        )
        VALUES ($1, $2, $3, $4, 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `,
      [user.id, user.email, passwordHash, user.role],
    );
  }
}

async function cleanupTemporaryData(client) {
  const auctionIds = [...tempAuctionIds];
  if (auctionIds.length > 0) {
    await client.query('DELETE FROM "BidRevealAttempt" WHERE "bidId" IN (SELECT "id" FROM "Bid" WHERE "auctionId" = ANY($1::uuid[]))', [auctionIds]);
    await client.query('DELETE FROM "BidCommitment" WHERE "bidId" IN (SELECT "id" FROM "Bid" WHERE "auctionId" = ANY($1::uuid[]))', [auctionIds]);
    await client.query('DELETE FROM "Bid" WHERE "auctionId" = ANY($1::uuid[])', [auctionIds]);
    await client.query('DELETE FROM "Auction" WHERE "id" = ANY($1::uuid[])', [auctionIds]);
  }
  await client.query('DELETE FROM "User" WHERE "id" = ANY($1::uuid[])', [tempUserIds]);
}

async function webRequest(pathname, options = {}) {
  const response = await fetch(`${webOrigin}${pathname}`, {
    method: options.method ?? "GET",
    headers: options.headers,
    body: options.body,
    cache: "no-store",
    redirect: options.redirect ?? "manual",
  });
  const text = await response.text();
  let json = null;
  try {
    json = text.length > 0 ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: response.status, headers: response.headers, text, json };
}

async function postJson(pathname, body, cookie, method = "POST") {
  return webRequest(pathname, {
    method,
    headers: {
      Origin: webOrigin,
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify(body),
  });
}

async function login(email, password) {
  const response = await postJson("/api/auth/login", { email, password }, null);
  assert(response.status === 200, `login failed with ${response.status}: ${response.text}`);
  const setCookie = response.headers.get("set-cookie");
  assert(setCookie, "login did not set session cookie");
  sensitiveValues.add(setCookie);
  const cookie = setCookie.split(";")[0];
  sensitiveValues.add(cookie);
  return { cookie, body: response.json };
}

function assertRedirect(response, expectedPath) {
  if (
    response.status === 200 &&
    response.text.includes("NEXT_REDIRECT") &&
    response.text.includes(expectedPath)
  ) {
    return;
  }
  assert(response.status === 307 || response.status === 308, `expected redirect, got ${response.status}`);
  const location = response.headers.get("location");
  assert(location, "redirect missing location");
  assert(new URL(location, webOrigin).pathname === expectedPath, `redirect did not target ${expectedPath}`);
}

function assertNoSensitiveText(text, label) {
  for (const value of sensitiveValues) {
    if (value) assert(!text.includes(value), `${label} leaked a sensitive value`);
  }
  assert(!/eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/.test(text), `${label} leaked a JWT`);
  for (const forbidden of [
    "accessToken",
    "passwordHash",
    "DATABASE_URL",
    "JWT_ACCESS_SECRET",
  ]) {
    assert(!text.includes(forbidden), `${label} leaked ${forbidden}`);
  }
}

function futureSchedule(hoursFromNow = 2) {
  const start = new Date(Date.now() + hoursFromNow * 60 * 60 * 1000);
  const reveal = new Date(start.getTime() + 60 * 60 * 1000);
  const end = new Date(reveal.getTime() + 60 * 60 * 1000);
  return {
    startTime: start.toISOString(),
    revealTime: reveal.toISOString(),
    endTime: end.toISOString(),
  };
}

async function createAuctionThroughHandler(cookie, title, overrides = {}) {
  const creationRequestId = randomUUID();
  sensitiveValues.add(creationRequestId);
  const body = {
    creationRequestId,
    title,
    description: `${title} description`,
    currency: "USD",
    ...futureSchedule(),
    ...overrides,
  };
  const response = await postJson("/api/admin/auctions", body, cookie);
  assert(response.status === 201, `auction creation failed with ${response.status}: ${response.text}`);
  tempAuctionIds.add(response.json.auction.id);
  return { body, response };
}

async function createEndedAuctionWithBids(client, title) {
  const auctionId = randomUUID();
  tempAuctionIds.add(auctionId);
  const now = new Date();
  const start = new Date(now.getTime() - 4 * 60 * 60 * 1000);
  const reveal = new Date(now.getTime() - 3 * 60 * 60 * 1000);
  const end = new Date(now.getTime() - 2 * 60 * 60 * 1000);
  await client.query(
    `
      INSERT INTO "Auction" (
        "id", "creationRequestId", "title", "description", "currency", "startTime",
        "revealTime", "endTime", "status", "createdById", "version", "createdAt", "updatedAt"
      )
      VALUES ($1, $2, $3, $4, 'USD', $5, $6, $7, 'PUBLISHED', $8, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `,
    [auctionId, randomUUID(), title, `${title} description`, start, reveal, end, adminId],
  );

  await insertRevealedBid(client, auctionId, bidderId, "12500", new Date(now.getTime() - 160 * 60 * 1000));
  await insertRevealedBid(client, auctionId, loserId, "11000", new Date(now.getTime() - 150 * 60 * 1000));
  return auctionId;
}

async function insertRevealedBid(client, auctionId, bidderIdValue, amountCents, committedAt) {
  const bidId = randomUUID();
  const commitmentId = randomUUID();
  const revealId = randomUUID();
  tempBidIds.add(bidId);
  tempCommitmentIds.add(commitmentId);
  tempRevealIds.add(revealId);
  await client.query(
    `
      INSERT INTO "Bid" ("id", "auctionId", "bidderId", "status", "version", "createdAt", "updatedAt")
      VALUES ($1, $2, $3, 'REVEALED', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `,
    [bidId, auctionId, bidderIdValue],
  );
  await client.query(
    `
      INSERT INTO "BidCommitment" (
        "id", "bidId", "clientRequestId", "commitmentHash", "protocolVersion",
        "isCurrent", "committedAt", "replacedAt", "createdAt"
      )
      VALUES ($1, $2, $3, $4, 1, TRUE, $5, NULL, CURRENT_TIMESTAMP)
    `,
    [commitmentId, bidId, randomUUID(), randomBytes(32).toString("hex"), committedAt],
  );
  await client.query(
    `
      INSERT INTO "BidRevealAttempt" (
        "id", "bidId", "clientRequestId", "amountCents", "secret",
        "validationStatus", "invalidReason", "submittedAt", "createdAt"
      )
      VALUES ($1, $2, $3, $4, 'stored-test-secret', 'VALID', NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `,
    [revealId, bidId, randomUUID(), amountCents],
  );
}

async function runPageAndAuthorizationTests(adminCookie, bidderCookie) {
  const unauthenticated = await webRequest("/admin/auctions");
  assertRedirect(unauthenticated, "/login");

  const bidderPage = await webRequest("/admin", { headers: { Cookie: bidderCookie } });
  assertRedirect(bidderPage, "/auctions");

  const bidderHandler = await postJson("/api/admin/auctions", {
    creationRequestId: randomUUID(),
    title: "Forbidden",
    currency: "USD",
    ...futureSchedule(),
  }, bidderCookie);
  assert(bidderHandler.status === 403, "bidder admin handler request did not return 403");

  const dashboard = await webRequest("/admin", { headers: { Cookie: adminCookie } });
  assert(dashboard.status === 200, "admin dashboard did not return 200");
  for (const expected of ["Administrator dashboard", "Create auction", "View all auctions", adminEmail]) {
    assert(dashboard.text.includes(expected), `dashboard missing ${expected}`);
  }
  assertNoSensitiveText(dashboard.text, "admin dashboard");
  assert(!dashboard.text.includes(adminId), "dashboard exposed administrator id");

  console.log("ok - administrator page authorization passed");
}

async function runCreationListingAndUpdateTests(adminCookie) {
  const { body, response } = await createAuctionThroughHandler(adminCookie, `Web Admin Draft ${runId}`);
  const auction = response.json.auction;
  assert(auction.status === "DRAFT", "created auction was not DRAFT");

  const retry = await postJson("/api/admin/auctions", body, adminCookie);
  assert(retry.status === 201, "idempotent creation retry did not return 201");
  assert(retry.json.auction.id === auction.id, "idempotent creation retry returned another auction");

  const invalidTiming = await postJson("/api/admin/auctions", {
    ...body,
    creationRequestId: randomUUID(),
    revealTime: body.startTime,
  }, adminCookie);
  assert(invalidTiming.status === 400, "invalid timing did not return 400");

  const unknownProperty = await postJson("/api/admin/auctions", {
    ...body,
    creationRequestId: randomUUID(),
    createdById: adminId,
  }, adminCookie);
  assert(unknownProperty.status === 400, "unknown property did not return 400");

  const list = await webRequest("/admin/auctions", { headers: { Cookie: adminCookie } });
  assert(list.status === 200, "auction listing page did not return 200");
  assert(list.text.includes(auction.title), "listing page missing created auction");
  assert(list.text.includes("DRAFT"), "listing page missing status label");
  assert(list.text.includes("Page"), "listing page missing pagination");
  assertNoSensitiveText(list.text, "auction listing");

  const filtered = await webRequest("/admin/auctions?status=DRAFT", { headers: { Cookie: adminCookie } });
  assert(filtered.status === 200, "status-filtered listing did not return 200");
  assert(filtered.text.includes(auction.title), "status filter did not include draft auction");

  const patch = await postJson(`/api/admin/auctions/${auction.id}`, {
    expectedVersion: auction.version,
    title: `${auction.title} Updated`,
    ...futureSchedule(3),
  }, adminCookie, "PATCH");
  assert(patch.status === 200, `draft update failed with ${patch.status}: ${patch.text}`);
  assert(patch.json.auction.version === auction.version + 1, "draft update did not increment version");

  const stalePatch = await postJson(`/api/admin/auctions/${auction.id}`, {
    expectedVersion: auction.version,
    title: "Stale title",
  }, adminCookie, "PATCH");
  assert(stalePatch.status === 409, "stale update did not return 409");

  console.log("ok - creation, listing, filtering, and update workflows passed");
  return patch.json.auction;
}

async function runLifecycleTests(adminCookie, client) {
  const draft = (await createAuctionThroughHandler(adminCookie, `Web Admin Publish ${runId}`)).response.json.auction;
  const publish = await postJson(`/api/admin/auctions/${draft.id}/publish`, {
    expectedVersion: draft.version,
  }, adminCookie);
  assert(publish.status === 200, "publish did not return 200");
  assert(publish.json.auction.status === "PUBLISHED", "published auction status mismatch");

  const editPublished = await postJson(`/api/admin/auctions/${draft.id}`, {
    expectedVersion: publish.json.auction.version,
    title: "Should not edit",
  }, adminCookie, "PATCH");
  assert(editPublished.status === 409, "published edit did not return 409");

  const cancelDraft = (await createAuctionThroughHandler(adminCookie, `Web Admin Cancel Draft ${runId}`)).response.json.auction;
  const cancelDraftResponse = await postJson(`/api/admin/auctions/${cancelDraft.id}/cancel`, {
    cancellationRequestId: randomUUID(),
    expectedVersion: cancelDraft.version,
    reason: "Administrative verification cancellation",
  }, adminCookie);
  assert(cancelDraftResponse.status === 200, "draft cancellation failed");
  assert(cancelDraftResponse.json.auction.status === "CANCELLED", "cancelled draft status mismatch");
  assert(cancelDraftResponse.json.auction.cancellationReason.includes("Administrative"), "cancel reason missing");

  const futurePublished = (await createAuctionThroughHandler(adminCookie, `Web Admin Cancel Future ${runId}`)).response.json.auction;
  const futurePublish = await postJson(`/api/admin/auctions/${futurePublished.id}/publish`, {
    expectedVersion: futurePublished.version,
  }, adminCookie);
  const cancelId = randomUUID();
  sensitiveValues.add(cancelId);
  const cancelFuture = await postJson(`/api/admin/auctions/${futurePublished.id}/cancel`, {
    cancellationRequestId: cancelId,
    expectedVersion: futurePublish.json.auction.version,
    reason: "Future cancellation verification",
  }, adminCookie);
  assert(cancelFuture.status === 200, "future published cancellation failed");
  const cancelRetry = await postJson(`/api/admin/auctions/${futurePublished.id}/cancel`, {
    cancellationRequestId: cancelId,
    expectedVersion: 999,
    reason: "Future cancellation verification",
  }, adminCookie);
  assert(cancelRetry.status === 200, "idempotent cancellation retry failed");

  const settlementAuctionId = await createEndedAuctionWithBids(client, `Web Admin Settlement ${runId}`);
  const settleId = randomUUID();
  sensitiveValues.add(settleId);
  const settle = await postJson(`/api/admin/auctions/${settlementAuctionId}/settle`, {
    settlementRequestId: settleId,
    expectedVersion: 0,
  }, adminCookie);
  assert(settle.status === 200, `settlement failed with ${settle.status}: ${settle.text}`);
  assert(settle.json.auction.status === "SETTLED", "settlement did not settle auction");
  assert(settle.json.summary.winner.amountCents === "12500", "settlement winner amount mismatch");
  const settleRetry = await postJson(`/api/admin/auctions/${settlementAuctionId}/settle`, {
    settlementRequestId: settleId,
    expectedVersion: 999,
  }, adminCookie);
  assert(settleRetry.status === 200, "idempotent settlement retry failed");

  const detail = await webRequest(`/admin/auctions/${settlementAuctionId}`, {
    headers: { Cookie: adminCookie },
  });
  assert(detail.status === 200, "settled detail page did not render");
  assert(detail.text.includes(loserEmail) === false, "detail exposed losing bidder email");
  assert(!detail.text.includes("11000"), "detail exposed losing amount");
  assert(detail.text.includes("12500") || detail.text.includes("$125.00"), "detail missing winning amount");
  assertNoSensitiveText(detail.text, "settled detail page");

  console.log("ok - publish, cancel, settle, and result workflows passed");
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

function runDesignAndLeakageChecks(outputs, renderedText) {
  const globals = readFileSync(resolve(webDirectory, "src/app/globals.css"), "utf8");
  for (const expected of [
    "--dashboard-background",
    "--module-background",
    "--status-success",
    "--status-warning",
    "--status-danger",
  ]) {
    assert(globals.includes(expected), `globals missing ${expected}`);
  }
  assert(globals.includes("@media (prefers-color-scheme: dark)"), "dark-mode tokens missing");

  const staticFiles = readFilesRecursively(resolve(webDirectory, ".next/static"));
  const browserDelivered = [
    renderedText,
    ...staticFiles.map((file) => readFileSync(file, "utf8")),
  ].join("\n");
  assertNoSensitiveText(browserDelivered, "browser-delivered admin files");
  assert(!browserDelivered.includes(apiBaseUrl), "browser bundle exposed backend URL");

  for (const output of outputs) {
    assertNoSensitiveText(output.raw(), "application output");
  }

  console.log("ok - design tokens and leakage checks passed");
}

async function main() {
  assert(databaseUrl, "DATABASE_URL is required for admin auction verification");
  await assertTcpReachable(databaseUrl);
  console.log("ok - PostgreSQL TCP endpoint is reachable");

  await runCommand(process.execPath, [npmCliPath, "run", "build", "--workspace", "@auction/commitment"]);
  console.log("ok - shared commitment package builds");

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
    await createTemporaryUsers(client);
    console.log("ok - temporary admin verification users created");

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

    await runPageAndAuthorizationTests(adminLogin.cookie, bidderLogin.cookie);
    await runCreationListingAndUpdateTests(adminLogin.cookie);
    await runLifecycleTests(adminLogin.cookie, client);

    const dashboard = await webRequest("/admin", { headers: { Cookie: adminLogin.cookie } });
    runDesignAndLeakageChecks([apiProcess.output, webProcess.output], dashboard.text);
  } finally {
    if (client._connected) {
      await cleanupTemporaryData(client).catch(() => undefined);
      await client.end().catch(() => undefined);
    }
    if (webProcess) await terminateChild(webProcess.child, webProcess.output, "frontend");
    if (apiProcess) await terminateChild(apiProcess.child, apiProcess.output, "API");
  }

  console.log("ok - web administrator auction verification passed");
}

main().catch((error) => {
  console.error(sanitizeOutput(error instanceof Error ? error.message : String(error)));
  process.exitCode = 1;
});
