import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, readFileSync } from "node:fs";
import { createConnection } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const apiDirectory = resolve(scriptDirectory, "..");
const envPath = resolve(apiDirectory, ".env");
const startupTimeoutMs = 10000;
const host = "127.0.0.1";
const port = 3101;

function parseEnvFile(path) {
  if (!existsSync(path)) {
    return {};
  }

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

  if (databaseUrl) {
    sanitized = sanitized.split(databaseUrl).join("[REDACTED_DATABASE_URL]");
  }

  return sanitized.replaceAll(/postgres(?:ql)?:\/\/[^\s'"]+/g, "[REDACTED_DATABASE_URL]");
}

function createEnvironment(overrides = {}) {
  return {
    ...process.env,
    ...fileEnv,
    NODE_ENV: "test",
    HOST: host,
    PORT: String(port),
    JWT_ACCESS_SECRET:
      process.env.JWT_ACCESS_SECRET ??
      fileEnv.JWT_ACCESS_SECRET ??
      "api-integration-access-secret-for-testing-only-123456789",
    JWT_REFRESH_SECRET:
      process.env.JWT_REFRESH_SECRET ??
      fileEnv.JWT_REFRESH_SECRET ??
      "api-integration-refresh-secret-for-testing-only-123456789",
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
  if (!condition) {
    throw new Error(message);
  }
}

function runCommand(command, args, options = {}) {
  return new Promise((resolveCommand, rejectCommand) => {
    const child = spawn(command, args, {
      cwd: apiDirectory,
      env: createEnvironment(options.env),
      stdio: ["ignore", "pipe", "pipe"],
    });
    const getOutput = createOutputBuffer(child);

    child.once("error", rejectCommand);
    child.once("close", (code, signal) => {
      if (code === 0) {
        resolveCommand({ output: getOutput() });
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

function wait(ms) {
  return new Promise((resolveWait) => setTimeout(resolveWait, ms));
}

function checkTcpConnection(url) {
  return new Promise((resolveConnection, rejectConnection) => {
    const parsedUrl = new URL(url);
    const socket = createConnection({
      host: parsedUrl.hostname,
      port: Number(parsedUrl.port || 5432),
    });

    socket.setTimeout(startupTimeoutMs);
    socket.once("connect", () => {
      socket.end();
      resolveConnection();
    });
    socket.once("timeout", () => {
      socket.destroy();
      rejectConnection(new Error("PostgreSQL connection timed out"));
    });
    socket.once("error", rejectConnection);
  });
}

async function requestJson(pathname) {
  const response = await fetch(`http://${host}:${port}${pathname}`);
  const body = await response.json();

  return {
    statusCode: response.status,
    body,
  };
}

async function waitForStartup(child, getOutput) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < startupTimeoutMs) {
    if (child.exitCode !== null) {
      throw new Error(`API exited before startup completed\n${getOutput()}`);
    }

    try {
      const response = await requestJson("/api/health/live");

      if (response.statusCode === 200) {
        return;
      }
    } catch {
      await wait(150);
    }
  }

  throw new Error(`API did not start within ${startupTimeoutMs}ms\n${getOutput()}`);
}

async function terminateChild(child, getOutput) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  child.kill("SIGTERM");

  const closeTimeout = wait(5000).then(() => "timeout");
  const result = await Promise.race([once(child, "close"), closeTimeout]);

  if (result === "timeout") {
    child.kill("SIGKILL");
    throw new Error(`API did not terminate after SIGTERM\n${getOutput()}`);
  }
}

async function verifyHealthEndpoints() {
  const child = spawn(process.execPath, ["dist/main.js"], {
    cwd: apiDirectory,
    env: createEnvironment(),
    stdio: ["ignore", "pipe", "pipe"],
  });
  const getOutput = createOutputBuffer(child);

  try {
    await waitForStartup(child, getOutput);

    const live = await requestJson("/api/health/live");
    assert(live.statusCode === 200, `Expected live status 200, got ${live.statusCode}`);
    assert(live.body.status === "ok", "Expected live status ok");
    assert(live.body.checks?.api === "up", "Expected live API check up");

    const ready = await requestJson("/api/health/ready");
    assert(ready.statusCode === 200, `Expected ready status 200, got ${ready.statusCode}`);
    assert(ready.body.status === "ok", "Expected ready status ok");
    assert(ready.body.checks?.api === "up", "Expected ready API check up");
    assert(ready.body.checks?.database === "up", "Expected ready database check up");

    await terminateChild(child, getOutput);
    console.log("ok - API health endpoints passed");
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
    }
  }
}

async function verifyInvalidConfigurationFailure() {
  const child = spawn(process.execPath, ["dist/main.js"], {
    cwd: apiDirectory,
    env: createEnvironment({ PORT: "invalid-port" }),
    stdio: ["ignore", "pipe", "pipe"],
  });
  const getOutput = createOutputBuffer(child);

  const result = await Promise.race([once(child, "close"), wait(startupTimeoutMs)]);

  if (!Array.isArray(result)) {
    child.kill("SIGKILL");
    throw new Error("Invalid configuration process did not exit within timeout");
  }

  const [code] = result;
  const output = getOutput();

  assert(code !== 0, "Invalid configuration process exited successfully");
  assert(
    output.includes("Config validation error") ||
      output.includes("PORT") ||
      output.includes("configuration validation"),
    `Invalid configuration failure did not look like validation\n${output}`,
  );

  console.log("ok - invalid configuration blocks startup");
}

async function verifyDatabaseStartupFailure() {
  const child = spawn(process.execPath, ["dist/main.js"], {
    cwd: apiDirectory,
    env: createEnvironment({
      DATABASE_URL: "postgresql://auction_app:invalid_password@127.0.0.1:5433/auction_missing?schema=public",
      DATABASE_CONNECTION_TIMEOUT_MS: "500",
      PORT: "3102",
    }),
    stdio: ["ignore", "pipe", "pipe"],
  });
  const getOutput = createOutputBuffer(child);

  const result = await Promise.race([once(child, "close"), wait(startupTimeoutMs)]);

  if (!Array.isArray(result)) {
    child.kill("SIGKILL");
    throw new Error(`Database failure process did not exit within timeout\n${getOutput()}`);
  }

  const [code] = result;

  assert(code !== 0, `Database failure process exited successfully\n${getOutput()}`);
  console.log("ok - database failure blocks startup");
}

assert(databaseUrl, "DATABASE_URL is required for integration verification");

await checkTcpConnection(databaseUrl);
console.log("ok - PostgreSQL TCP endpoint is reachable");

await runCommand("npm", ["run", "build"]);
console.log("ok - NestJS application builds");

await verifyHealthEndpoints();
await verifyInvalidConfigurationFailure();
await verifyDatabaseStartupFailure();

console.log("ok - API integration verification passed");
