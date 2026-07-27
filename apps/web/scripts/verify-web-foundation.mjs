import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import net from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const webDirectory = resolve(scriptDirectory, "..");
const apiDirectory = resolve(webDirectory, "../api");
const rootDirectory = resolve(webDirectory, "../..");
const apiEnvPath = resolve(apiDirectory, ".env");
const webHost = "127.0.0.1";
const webPort = 3109;
const apiHost = "127.0.0.1";
const apiPort = 3110;
const startupTimeoutMs = 20_000;
const apiBaseUrl = `http://${apiHost}:${apiPort}/api`;
const jwtSecret = "web-foundation-verifier-secret-with-at-least-32-characters";

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

const apiFileEnv = parseEnvFile(apiEnvPath);
const databaseUrl = process.env.DATABASE_URL ?? apiFileEnv.DATABASE_URL;

function sanitizeOutput(output) {
  let sanitized = output;
  for (const value of [databaseUrl, jwtSecret, apiBaseUrl]) {
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
  return () => sanitizeOutput(Buffer.concat(chunks).toString("utf8"));
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
    API_BASE_URL: apiBaseUrl,
    HOSTNAME: webHost,
    PORT: String(webPort),
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
    const socket = net.createConnection({
      host: url.hostname,
      port,
    });
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

async function request(pathname, port = webPort) {
  return fetch(`http://${webHost}:${port}${pathname}`, {
    cache: "no-store",
  });
}

async function requestJson(pathname) {
  const response = await request(pathname);
  let body = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  return { response, body };
}

async function waitForHttp(pathname, port, getOutput, name) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < startupTimeoutMs) {
    try {
      const response = await request(pathname, port);
      if (response.status < 500) return;
    } catch {
      await wait(150);
    }
  }
  throw new Error(`${name} did not start within ${startupTimeoutMs}ms\n${getOutput()}`);
}

async function terminateChild(child, getOutput, name) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  const result = await Promise.race([once(child, "close"), wait(5000)]);
  if (!Array.isArray(result)) {
    child.kill("SIGKILL");
    throw new Error(`${name} did not terminate after SIGTERM\n${getOutput()}`);
  }
}

function assertHomepage(html) {
  for (const expected of [
    "Auction House",
    "Secure sealed-bid auctions",
    "Scheduled auctions",
    "Sealed commitments",
    "Timed bid reveals",
    "Deterministic settlement",
  ]) {
    assert(html.includes(expected), `homepage did not include ${expected}`);
  }

  for (const tag of ["header", "main", "footer"]) {
    assert(new RegExp(`<${tag}(\\s|>)`).test(html), `homepage did not include ${tag}`);
  }
}

function assertHealthSuccess(body) {
  assert(body?.status === "ok", "health proxy success status mismatch");
  assert(body.services?.web === "up", "health proxy web status mismatch");
  assert(body.services?.api === "up", "health proxy api status mismatch");
  assert(body.services?.database === "up", "health proxy database status mismatch");
}

function assertHealthFailure(body) {
  assert(body?.status === "error", "health proxy failure status mismatch");
  assert(body.services?.web === "up", "health proxy failure web status mismatch");
  assert(body.services?.api === "down", "health proxy failure api status mismatch");
  assert(
    body.services?.database === "unknown",
    "health proxy failure database status mismatch",
  );
}

function readFilesRecursively(directory) {
  if (!existsSync(directory)) return [];

  const files = [];
  for (const entry of readdirSync(directory)) {
    const path = resolve(directory, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      files.push(...readFilesRecursively(path));
      continue;
    }
    if (stat.isFile()) {
      files.push(path);
    }
  }
  return files;
}

function assertNoBrowserLeakage(homepageHtml) {
  const forbidden = [
    "API_BASE_URL",
    "DATABASE_URL",
    "JWT_ACCESS_SECRET",
    "DEV_ADMIN_PASSWORD",
    "DEV_BIDDER_PASSWORD",
    "127.0.0.1:3110",
    "127.0.0.1:5433",
  ];

  const staticDirectory = resolve(webDirectory, ".next/static");
  const haystacks = [
    { name: "homepage HTML", content: homepageHtml },
    ...readFilesRecursively(staticDirectory).map((path) => ({
      name: path,
      content: readFileSync(path, "utf8"),
    })),
  ];

  for (const haystack of haystacks) {
    for (const value of forbidden) {
      assert(!haystack.content.includes(value), `${haystack.name} leaked ${value}`);
    }
  }
}

async function main() {
  requireNodeVersion();
  console.log("ok - Node version satisfies frontend requirements");

  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  await assertTcpReachable(databaseUrl);
  console.log("ok - PostgreSQL TCP endpoint is reachable");

  await runCommand("npm", ["run", "build", "--workspace", "apps/api"], {
    env: createApiEnvironment(),
  });
  console.log("ok - NestJS application builds");

  await runCommand("npm", ["run", "build", "--workspace", "@auction/web"], {
    env: createWebEnvironment(),
  });
  console.log("ok - Next.js application builds");

  let api = null;
  let web = null;
  let getApiOutput = () => "";
  let getWebOutput = () => "";

  try {
    api = spawn(process.execPath, ["dist/main.js"], {
      cwd: apiDirectory,
      env: createApiEnvironment(),
      stdio: ["ignore", "pipe", "pipe"],
    });
    getApiOutput = createOutputBuffer(api);
    await waitForHttp("/api/health/live", apiPort, getApiOutput, "API");
    console.log("ok - API started");

    web = spawn("npm", ["run", "start", "--workspace", "@auction/web", "--", "-H", webHost, "-p", String(webPort)], {
      cwd: rootDirectory,
      env: createWebEnvironment(),
      stdio: ["ignore", "pipe", "pipe"],
    });
    getWebOutput = createOutputBuffer(web);
    await waitForHttp("/", webPort, getWebOutput, "frontend");
    console.log("ok - frontend started");

    const homepageResponse = await request("/");
    assert(homepageResponse.status === 200, "homepage should return HTTP 200");
    const homepageHtml = await homepageResponse.text();
    assertHomepage(homepageHtml);
    console.log("ok - homepage renders expected foundation content");

    const healthy = await requestJson("/api/system/health");
    assert(healthy.response.status === 200, "health proxy should return HTTP 200");
    assertHealthSuccess(healthy.body);
    console.log("ok - health proxy returns safe success response");

    await terminateChild(api, getApiOutput, "API");
    api = null;

    const unhealthy = await requestJson("/api/system/health");
    assert(unhealthy.response.status === 503, "health proxy should return HTTP 503");
    assertHealthFailure(unhealthy.body);
    const unhealthyText = JSON.stringify(unhealthy.body);
    assert(!unhealthyText.includes(apiBaseUrl), "health proxy leaked backend URL");
    assert(!unhealthyText.toLowerCase().includes("stack"), "health proxy leaked stack details");
    console.log("ok - health proxy returns safe failure response");

    assertNoBrowserLeakage(homepageHtml);
    console.log("ok - browser-delivered files do not expose server configuration");

    console.log("ok - web foundation verification passed");
  } finally {
    await terminateChild(api, getApiOutput, "API");
    await terminateChild(web, getWebOutput, "frontend");
  }
}

main().catch((error) => {
  console.error(sanitizeOutput(error instanceof Error ? error.stack ?? error.message : String(error)));
  process.exitCode = 1;
});
