import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Client } = pg;

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const webDirectory = resolve(scriptDirectory, "..");
const apiDirectory = resolve(webDirectory, "../api");
const rootDirectory = resolve(webDirectory, "../..");
const apiEnvPath = resolve(apiDirectory, ".env");
const webHost = "localhost";
const webPort = 3119;
const apiHost = "127.0.0.1";
const apiPort = 3120;
const webOrigin = `http://${webHost}:${webPort}`;
const apiBaseUrl = `http://${apiHost}:${apiPort}/api`;
const startupTimeoutMs = 20_000;
const npmCliPath =
  process.env.npm_execpath ?? "/usr/local/lib/node_modules/npm/bin/npm-cli.js";
const jwtSecret = randomBytes(32).toString("base64url");
const namespace = process.env.E2E_NAMESPACE ?? `e2e-${randomUUID()}`;

const sensitiveValues = new Set([jwtSecret, apiBaseUrl]);

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
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
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
    .replaceAll(/eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g, "[REDACTED_TOKEN]")
    .replaceAll(/[A-Za-z0-9_-]{43}/g, "[REDACTED_SECRET_LIKE_VALUE]");
}

function createOutputBuffer(child) {
  const chunks = [];
  child.stdout.on("data", (chunk) => chunks.push(chunk));
  child.stderr.on("data", (chunk) => chunks.push(chunk));
  return {
    sanitized: () => sanitizeOutput(Buffer.concat(chunks).toString("utf8")),
  };
}

function requireNodeVersion() {
  const [major, minor, patch] = process.versions.node
    .split(".")
    .map((part) => Number.parseInt(part, 10));

  assert(
    major > 20 ||
      (major === 20 && (minor > 19 || (minor === 19 && patch >= 0))),
    `Node ${process.versions.node} does not satisfy >=20.19.0`,
  );
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

async function waitForHttp(url, output, name) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < startupTimeoutMs) {
    try {
      const response = await fetch(url, { cache: "no-store", redirect: "manual" });
      if (response.status < 500) return;
    } catch {
      await wait(150);
    }
  }
  throw new Error(`${name} did not start within ${startupTimeoutMs}ms\n${output.sanitized()}`);
}

function createApiEnvironment() {
  return {
    ...process.env,
    ...apiFileEnv,
    NODE_ENV: "test",
    HOST: apiHost,
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
    HOSTNAME: webHost,
    PORT: String(webPort),
    E2E_NAMESPACE: namespace,
  };
}

async function cleanupNamespace(client) {
  const users = await client.query('SELECT "id" FROM "User" WHERE "email" LIKE $1', [
    `${namespace}-%@example.test`,
  ]);
  const userIds = users.rows.map((row) => row.id);
  const auctions = await client.query(
    'SELECT "id" FROM "Auction" WHERE "title" LIKE $1 OR "createdById" = ANY($2::uuid[])',
    [`${namespace} %`, userIds],
  );
  const auctionIds = auctions.rows.map((row) => row.id);

  if (auctionIds.length > 0) {
    await client.query(
      'DELETE FROM "BidRevealAttempt" WHERE "bidId" IN (SELECT "id" FROM "Bid" WHERE "auctionId" = ANY($1::uuid[]))',
      [auctionIds],
    );
    await client.query(
      'DELETE FROM "BidCommitment" WHERE "bidId" IN (SELECT "id" FROM "Bid" WHERE "auctionId" = ANY($1::uuid[]))',
      [auctionIds],
    );
    await client.query('DELETE FROM "Bid" WHERE "auctionId" = ANY($1::uuid[])', [
      auctionIds,
    ]);
    await client.query('DELETE FROM "Auction" WHERE "id" = ANY($1::uuid[])', [
      auctionIds,
    ]);
  }

  if (userIds.length > 0) {
    await client.query('DELETE FROM "User" WHERE "id" = ANY($1::uuid[])', [userIds]);
  }
}

async function createDatabaseClient() {
  assert(databaseUrl, "DATABASE_URL is required");
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  return client;
}

async function readPlaywrightStats(resultsFile) {
  const payload = JSON.parse(await readFile(resultsFile, "utf8"));
  const stats = payload?.stats;
  assert(stats && typeof stats === "object", "Playwright results did not contain stats");
  const expected = Number(stats.expected ?? 0);
  const skipped = Number(stats.skipped ?? 0);
  const unexpected = Number(stats.unexpected ?? 0);
  const flaky = Number(stats.flaky ?? 0);
  const total = expected + skipped + unexpected + flaky;

  assert(total > 0, "Playwright did not run any tests");
  assert(skipped === 0, `Playwright skipped ${skipped} test(s)`);
  assert(unexpected === 0, `Playwright had ${unexpected} unexpected result(s)`);

  return { expected, skipped, unexpected, flaky, total };
}

async function main() {
  requireNodeVersion();
  console.log("ok - Node version satisfies system E2E requirements");

  assert(databaseUrl, "DATABASE_URL is required");
  await assertTcpReachable(databaseUrl);
  console.log("ok - PostgreSQL TCP endpoint is reachable");

  const client = await createDatabaseClient();
  await cleanupNamespace(client);
  console.log("ok - temporary namespace is clean");

  await runCommand("npx", ["prisma", "migrate", "status", "--config", "prisma.config.ts"], {
    cwd: apiDirectory,
    env: createApiEnvironment(),
  });
  console.log("ok - Prisma migration status is current");

  await runCommand(process.execPath, [npmCliPath, "run", "build", "--workspace", "@auction/commitment"]);
  console.log("ok - commitment package builds");

  await runCommand(process.execPath, [npmCliPath, "run", "build", "--workspace", "apps/api"], {
    env: createApiEnvironment(),
  });
  console.log("ok - NestJS application builds");

  await runCommand(process.execPath, [npmCliPath, "run", "build", "--workspace", "@auction/web"], {
    env: createWebEnvironment(),
  });
  console.log("ok - Next.js application builds");

  let api = null;
  let web = null;
  const resultsDirectory = await mkdtemp(join(tmpdir(), "auction-system-e2e-"));
  const resultsFile = join(resultsDirectory, "playwright-results.json");

  try {
    api = startProcess(process.execPath, ["dist/main.js"], {
      cwd: apiDirectory,
      env: createApiEnvironment(),
    });
    await waitForHttp(`http://${apiHost}:${apiPort}/api/health/live`, api.output, "API");
    console.log("ok - production API started");

    web = startProcess(
      process.execPath,
      [npmCliPath, "run", "start", "--workspace", "@auction/web", "--", "-H", webHost, "-p", String(webPort)],
      {
        cwd: rootDirectory,
        env: createWebEnvironment(),
      },
    );
    await waitForHttp(`${webOrigin}/`, web.output, "frontend");
    await waitForHttp(`${webOrigin}/api/system/health`, web.output, "frontend health proxy");
    console.log("ok - production frontend started");

    await runCommand(process.execPath, [npmCliPath, "run", "test:e2e", "--workspace", "@auction/web"], {
      cwd: rootDirectory,
      env: {
        ...createWebEnvironment(),
        E2E_NAMESPACE: namespace,
        E2E_RESULTS_FILE: resultsFile,
      },
    });
    const stats = await readPlaywrightStats(resultsFile);
    console.log(
      `ok - Playwright system E2E suite passed (${stats.expected} passed, ${stats.skipped} skipped, ${stats.unexpected} failed)`,
    );
  } finally {
    await terminateChild(api?.child, api?.output ?? { sanitized: () => "" }, "API");
    await terminateChild(web?.child, web?.output ?? { sanitized: () => "" }, "frontend");
    await rm(resultsDirectory, { recursive: true, force: true });
    await cleanupNamespace(client);
    await client.end();
    console.log("ok - temporary E2E records cleaned");
  }
}

main().catch((error) => {
  console.error(sanitizeOutput(error instanceof Error ? error.stack ?? error.message : String(error)));
  process.exitCode = 1;
});
