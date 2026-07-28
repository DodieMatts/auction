import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";

const rootDirectory = new URL("../", import.meta.url).pathname.replace(/\/$/, "");
const composeFile = join(rootDirectory, "docker-compose.production.yml");
const projectName = `auction-production-${randomUUID().slice(0, 8)}`;
const temporaryDirectory = await mkdtemp(join(tmpdir(), "auction-production-"));
const envFile = join(temporaryDirectory, "production.env");
const databasePassword = `db-${randomBytes(18).toString("base64url")}`;
const jwtSecret = randomBytes(48).toString("base64url");
const sensitiveValues = new Set([databasePassword, jwtSecret]);
let environmentCreated = false;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function redact(value) {
  let output = value;
  for (const sensitiveValue of sensitiveValues) {
    output = output.split(sensitiveValue).join("[REDACTED]");
  }
  return output
    .replaceAll(/postgres(?:ql)?:\/\/[^\s'"]+/g, "[REDACTED_DATABASE_URL]")
    .replaceAll(/eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g, "[REDACTED_TOKEN]");
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function run(command, args, { allowFailure = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: rootDirectory,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.once("error", (error) => reject(error));
    child.once("close", (code, signal) => {
      const result = {
        code,
        signal,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      };
      if (code === 0 || allowFailure) {
        resolve(result);
        return;
      }
      reject(
        new Error(
          `${command} ${args.join(" ")} failed with code ${code ?? "null"}\n${redact(result.stdout + result.stderr)}`,
        ),
      );
    });
  });
}

function compose(args, options = {}) {
  return run(
    "docker",
    [
      "compose",
      "--project-name",
      projectName,
      "--file",
      composeFile,
      "--env-file",
      envFile,
      ...args,
    ],
    options,
  );
}

function requireNodeVersion() {
  assert(
    process.versions.node === "20.19.0",
    `Node ${process.versions.node} is active; production verification requires 20.19.0`,
  );
}

async function waitForHttp(url, expectedStatus, timeoutMs = 120_000) {
  const startedAt = Date.now();
  let lastError = "no response";
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (response.status === expectedStatus) return response;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : "request failed";
    }
    await delay(500);
  }
  throw new Error(`${url} did not return HTTP ${expectedStatus}: ${lastError}`);
}

async function waitForMigration() {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 120_000) {
    const result = await compose(
      ["ps", "-a", "--format", "{{.Service}}|{{.State}}|{{.ExitCode}}"],
      { allowFailure: true },
    );
    const migrationLine = result.stdout
      .split(/\r?\n/)
      .find((line) => line.startsWith("migrate|"));
    if (migrationLine?.startsWith("migrate|exited|0")) return;
    if (migrationLine?.startsWith("migrate|exited|")) {
      throw new Error(`Production migration failed: ${redact(migrationLine)}`);
    }
    await delay(500);
  }
  throw new Error("Production migration did not complete within 120 seconds");
}

async function waitForContainerHealth(serviceNames) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 120_000) {
    let healthy = true;
    for (const serviceName of serviceNames) {
      const container = await compose(["ps", "-q", serviceName], { allowFailure: true });
      const containerId = container.stdout.trim();
      if (!containerId) {
        healthy = false;
        break;
      }
      const status = await run(
        "docker",
        ["inspect", "--format", "{{.State.Health.Status}}", containerId],
        { allowFailure: true },
      );
      if (status.stdout.trim() !== "healthy") {
        healthy = false;
        break;
      }
    }
    if (healthy) return;
    await delay(500);
  }
  throw new Error(`Container health checks did not pass: ${serviceNames.join(", ")}`);
}

async function getServiceContainerId(serviceName) {
  const result = await compose(["ps", "-q", serviceName], { allowFailure: true });
  return result.stdout.trim();
}

async function getContainerPortBindings(serviceName) {
  const containerId = await getServiceContainerId(serviceName);
  if (!containerId) {
    return { containerId: null, hostBindings: null, networkPorts: null };
  }

  const [hostResult, networkResult] = await Promise.all([
    run(
      "docker",
      ["inspect", "--format", "{{json .HostConfig.PortBindings}}", containerId],
      { allowFailure: true },
    ),
    run(
      "docker",
      ["inspect", "--format", "{{json .NetworkSettings.Ports}}", containerId],
      { allowFailure: true },
    ),
  ]);

  return {
    containerId,
    hostBindings: hostResult.stdout.trim() || null,
    networkPorts: networkResult.stdout.trim() || null,
  };
}

async function assertSecurityHeaders() {
  const response = await fetch("http://127.0.0.1:8080/", { cache: "no-store" });
  assert(response.status === 200, `Public homepage returned HTTP ${response.status}`);
  const expectedHeaders = {
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "no-referrer",
    "permissions-policy": "camera=(), microphone=(), geolocation=()",
    "cross-origin-opener-policy": "same-origin",
    "cross-origin-resource-policy": "same-origin",
  };
  for (const [name, value] of Object.entries(expectedHeaders)) {
    assert(
      response.headers.get(name) === value,
      `Missing or incorrect security header: ${name}`,
    );
  }
}

async function assertPortIsolation() {
  const config = await compose(["config", "--format", "json"]);
  const parsed = JSON.parse(config.stdout);
  const services = parsed.services ?? {};
  const nginxPorts = services.nginx?.ports;
  assert(
    Array.isArray(nginxPorts) && nginxPorts.length === 1,
    "Nginx must have exactly one published port",
  );
  const nginxPort = nginxPorts[0];
  assert(
    nginxPort.target === 8080 &&
      String(nginxPort.published) === "8080" &&
      nginxPort.host_ip === "127.0.0.1" &&
      nginxPort.protocol === "tcp",
    `Nginx port mapping is invalid: ${JSON.stringify(nginxPorts)}`,
  );
  for (const serviceName of ["postgres", "api", "web"]) {
    assert(
      !Array.isArray(services[serviceName]?.ports) || services[serviceName].ports.length === 0,
      `${serviceName} must not publish a host port`,
    );
  }
  console.log("ok - resolved Compose mapping publishes 127.0.0.1:8080 and keeps internal services private");
}

async function assertRuntimeNginxPortBinding() {
  const bindings = await getContainerPortBindings("nginx");
  assert(bindings.hostBindings, "Nginx container has no readable host port bindings");

  let parsedBindings;
  try {
    parsedBindings = JSON.parse(bindings.hostBindings);
  } catch {
    throw new Error("Nginx container returned invalid host port binding data");
  }

  const publishedBindings = parsedBindings?.["8080/tcp"];
  assert(
    Array.isArray(publishedBindings) &&
      publishedBindings.length === 1 &&
      publishedBindings[0].HostIp === "127.0.0.1" &&
      publishedBindings[0].HostPort === "8080",
    `Nginx runtime port binding is invalid: ${bindings.hostBindings}`,
  );
  console.log("ok - Docker applied 127.0.0.1:8080->8080/tcp to Nginx");
}

async function assertNonRoot(serviceName) {
  const result = await compose(["exec", "-T", serviceName, "id", "-u"]);
  const userId = result.stdout.trim();
  assert(userId && userId !== "0", `${serviceName} is running as root`);
}

async function assertImageSecrets(serviceName) {
  const imageResult = await compose(["images", "-q", serviceName]);
  const imageId = imageResult.stdout.trim().split(/\s+/)[0];
  assert(imageId, `Could not identify the ${serviceName} image`);
  const history = await run("docker", ["image", "history", "--no-trunc", imageId]);
  const imageText = history.stdout + history.stderr;
  for (const secret of sensitiveValues) {
    assert(!imageText.includes(secret), `${serviceName} image history contains a runtime secret`);
  }
}

async function main() {
  requireNodeVersion();
  await run("docker", ["info"]);
  await run("docker", ["compose", "version"]);

  await writeFile(
    envFile,
    [
      "NODE_ENV=production",
      "POSTGRES_USER=auction_app",
      `POSTGRES_PASSWORD=${databasePassword}`,
      "POSTGRES_DB=auction",
      `DATABASE_URL=postgresql://auction_app:${databasePassword}@postgres:5432/auction?schema=public`,
      "DATABASE_POOL_MAX=10",
      "DATABASE_CONNECTION_TIMEOUT_MS=5000",
      "DATABASE_IDLE_TIMEOUT_MS=30000",
      `JWT_ACCESS_SECRET=${jwtSecret}`,
      "JWT_ACCESS_TTL_SECONDS=900",
      "JWT_ISSUER=auction-api",
      "JWT_AUDIENCE=auction-web",
      "HOST=0.0.0.0",
      "PORT=3000",
      "API_BASE_URL=http://api:3000/api",
      "ALLOWED_APP_ORIGIN=http://127.0.0.1:8080",
      "",
    ].join("\n"),
    { mode: 0o600 },
  );
  environmentCreated = true;

  await compose(["config", "--quiet"]);
  await assertPortIsolation();
  await compose(["build"]);
  await compose(["up", "-d"]);
  await waitForMigration();
  await waitForContainerHealth(["api", "web"]);
  await waitForContainerHealth(["nginx"]);
  await assertRuntimeNginxPortBinding();
  await waitForHttp("http://127.0.0.1:8080/healthz", 200);
  await waitForHttp("http://127.0.0.1:8080/", 200);
  const healthyResponse = await waitForHttp("http://127.0.0.1:8080/api/system/health", 200);
  const healthyBody = await healthyResponse.json();
  assert(
    healthyBody.status === "ok" && healthyBody.services.api === "up" && healthyBody.services.database === "up",
    "Web health proxy did not report all services as healthy",
  );
  await assertSecurityHeaders();
  await assertNonRoot("api");
  await assertNonRoot("web");
  await assertNonRoot("nginx");
  await assertImageSecrets("api");
  await assertImageSecrets("web");

  await compose(["stop", "api"]);
  const unavailableResponse = await waitForHttp("http://127.0.0.1:8080/api/system/health", 503);
  const unavailableBody = await unavailableResponse.json();
  assert(
    unavailableBody.status === "error" && unavailableBody.services.api === "down",
    "Web health proxy did not detect the stopped API",
  );

  await compose(["up", "-d", "api"]);
  const recoveredResponse = await waitForHttp("http://127.0.0.1:8080/api/system/health", 200);
  const recoveredBody = await recoveredResponse.json();
  assert(recoveredBody.status === "ok", "Web health proxy did not recover after API restart");

  await compose(["stop", "api", "web", "nginx"]);
  console.log("ok - production containers passed health, isolation, recovery, and safety checks");
}

let failure;
try {
  await main();
} catch (error) {
  failure = error;
  console.error(error instanceof Error ? error.message : "Production container verification failed");
  if (environmentCreated) {
    const nginxBindings = await getContainerPortBindings("nginx");
    console.error(
      `Nginx runtime bindings: ${JSON.stringify({
        hostConfig: nginxBindings.hostBindings,
        network: nginxBindings.networkPorts,
      })}`,
    );
    const logs = await compose(["logs", "--no-color"], { allowFailure: true });
    const sanitizedLogs = redact(logs.stdout + logs.stderr);
    await writeFile(join(rootDirectory, "production-container-verification.log"), sanitizedLogs);
    if (sanitizedLogs.trim()) console.error(sanitizedLogs.slice(-12_000));
  }
} finally {
  if (environmentCreated) {
    await compose(["down", "--volumes", "--remove-orphans"], { allowFailure: true });
  }
  await rm(temporaryDirectory, { recursive: true, force: true });
}

if (failure) process.exitCode = 1;
