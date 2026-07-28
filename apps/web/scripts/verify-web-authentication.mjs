import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
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
const webPort = 3111;
const apiPort = 3112;
const webOrigin = `http://${host}:${webPort}`;
const apiBaseUrl = `http://${host}:${apiPort}/api`;
const startupTimeoutMs = 20_000;
const jwtSecret = randomBytes(32).toString("base64url");
const runId = randomUUID();
const adminId = randomUUID();
const bidderId = randomUUID();
const suspendedId = randomUUID();
const adminEmail = `web-auth-admin-${runId}@example.test`;
const bidderEmail = `web-auth-bidder-${runId}@example.test`;
const suspendedEmail = `web-auth-suspended-${runId}@example.test`;
const adminPassword = "WebAuthAdmin123!";
const bidderPassword = "WebAuthBidder123!";
const suspendedPassword = "WebAuthSuspended123!";
const tempUserIds = [adminId, bidderId, suspendedId];
const sensitiveValues = new Set([
  jwtSecret,
  adminPassword,
  bidderPassword,
  suspendedPassword,
]);

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function wait(ms) {
  return new Promise((resolveWait) => setTimeout(resolveWait, ms));
}

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

const apiFileEnv = parseEnvFile(apiEnvPath);
const databaseUrl = process.env.DATABASE_URL ?? apiFileEnv.DATABASE_URL;
if (databaseUrl) {
  sensitiveValues.add(databaseUrl);
}

function sanitizeOutput(output) {
  let sanitized = output;
  for (const value of sensitiveValues) {
    if (value) {
      sanitized = sanitized.split(value).join("[REDACTED]");
    }
  }

  return sanitized
    .replaceAll(/postgres(?:ql)?:\/\/[^\s'"]+/g, "[REDACTED_DATABASE_URL]")
    .replaceAll(
      /eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g,
      "[REDACTED_TOKEN]",
    );
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
  const output = createOutputBuffer(child);
  return { child, output };
}

async function terminateChild(child, output, name) {
  if (!child || child.exitCode !== null || child.signalCode !== null) {
    return;
  }

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
      if (response.status < 500) {
        return;
      }
    } catch {
      await wait(150);
    }
  }

  throw new Error(`${name} did not start within ${startupTimeoutMs}ms\n${output.sanitized()}`);
}

async function createTemporaryUsers(client) {
  const users = [
    {
      id: adminId,
      email: adminEmail,
      password: adminPassword,
      role: "ADMIN",
      status: "ACTIVE",
    },
    {
      id: bidderId,
      email: bidderEmail,
      password: bidderPassword,
      role: "BIDDER",
      status: "ACTIVE",
    },
    {
      id: suspendedId,
      email: suspendedEmail,
      password: suspendedPassword,
      role: "BIDDER",
      status: "ACTIVE",
    },
  ];

  for (const user of users) {
    const passwordHash = await argon2.hash(user.password, {
      type: argon2.argon2id,
    });
    await client.query(
      `
        INSERT INTO "User" (
          "id",
          "email",
          "passwordHash",
          "role",
          "status",
          "createdAt",
          "updatedAt"
        )
        VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `,
      [user.id, user.email, passwordHash, user.role, user.status],
    );
  }
}

async function cleanupTemporaryUsers(client) {
  await client.query('DELETE FROM "User" WHERE "id" = ANY($1::uuid[])', [
    tempUserIds,
  ]);
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

  return {
    status: response.status,
    headers: response.headers,
    text,
    json,
  };
}

async function postJson(pathname, body, headers = {}) {
  return webRequest(pathname, {
    method: "POST",
    headers: {
      Origin: webOrigin,
      Accept: "application/json",
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

async function login(email, password, returnTo) {
  const response = await postJson("/api/auth/login", {
    email,
    password,
    ...(returnTo ? { returnTo } : {}),
  });

  assert(
    response.status === 200,
    `login failed unexpectedly with ${response.status}: ${response.text}`,
  );
  const setCookie = response.headers.get("set-cookie");
  assert(setCookie, "login did not set a session cookie");
  assertCookieSettings(setCookie);
  assertSafeLoginBody(response.json);
  sensitiveValues.add(setCookie);
  const cookie = setCookie.split(";")[0];
  sensitiveValues.add(cookie);

  return {
    body: response.json,
    cookie,
    setCookie,
  };
}

function assertCookieSettings(setCookie) {
  const normalized = setCookie.toLowerCase();
  assert(
    setCookie.startsWith("auction_session="),
    "session cookie name mismatch",
  );
  for (const expected of [
    "HttpOnly",
    "SameSite=Lax",
    "Path=/",
    "Priority=High",
    "Max-Age=900",
    "Secure",
  ]) {
    assert(
      normalized.includes(expected.toLowerCase()),
      `session cookie missing ${expected}`,
    );
  }
}

function assertSafeLoginBody(body) {
  assert(body?.user, "login response missing user");
  assert(typeof body.expiresIn === "number", "login response missing expiry");
  assert(typeof body.redirectTo === "string", "login response missing redirect");
  assert(!("accessToken" in body), "login response exposed access token");
  assert(!("tokenType" in body), "login response exposed token type");
  assert(!("passwordHash" in body.user), "login response exposed password hash");
}

function assertNoSetCookie(response, message) {
  assert(!response.headers.get("set-cookie"), message);
}

function assertRedirect(response, expectedPath) {
  if (
    response.status === 200 &&
    response.text.includes("NEXT_REDIRECT") &&
    response.text.includes(expectedPath)
  ) {
    return;
  }

  assert(
    response.status === 307 || response.status === 308,
    `expected redirect to ${expectedPath}, received ${response.status} with location ${response.headers.get("location") ?? "none"}`,
  );
  const location = response.headers.get("location");
  assert(location, "redirect missing location");
  assert(
    new URL(location, webOrigin).pathname === expectedPath,
    `redirect did not target ${expectedPath}`,
  );
}

function assertNoSensitiveText(text, label) {
  for (const value of sensitiveValues) {
    if (value) {
      assert(!text.includes(value), `${label} leaked a sensitive value`);
    }
  }
  assert(!/eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/.test(text), `${label} leaked a JWT`);
  assert(!text.includes("passwordHash"), `${label} leaked passwordHash`);
  assert(!text.includes("accessToken"), `${label} leaked accessToken`);
}

async function runPublicPageTests() {
  for (const pathname of ["/", "/login"]) {
    const response = await webRequest(pathname);
    assert(response.status === 200, `${pathname} did not return 200`);
    assertNoSensitiveText(response.text, pathname);
  }

  const loginPage = await webRequest("/login");
  for (const expected of ["Email", "Password", "Sign in"]) {
    assert(loginPage.text.includes(expected), `login page missing ${expected}`);
  }

  console.log("ok - public authentication pages passed");
}

async function runProxyTests() {
  const admin = await webRequest("/admin");
  assertRedirect(admin, "/login");
  assert(
    new URL(admin.headers.get("location"), webOrigin).searchParams.get("next") ===
      "/admin",
    "admin proxy did not preserve local next path",
  );

  const auctions = await webRequest("/auctions");
  assertRedirect(auctions, "/login");
  assert(
    new URL(auctions.headers.get("location"), webOrigin).searchParams.get("next") ===
      "/auctions",
    "auction proxy did not preserve local next path",
  );

  const malformedNext = await login(
    bidderEmail,
    bidderPassword,
    "https://example.test/admin",
  );
  assert(
    malformedNext.body.redirectTo === "/auctions",
    "malformed return path was not ignored",
  );

  console.log("ok - optimistic proxy redirects passed");
}

async function runLoginFailureTests() {
  const cases = [
    {
      name: "wrong password",
      response: await postJson("/api/auth/login", {
        email: bidderEmail,
        password: "WrongPassword123!",
      }),
      status: 401,
    },
    {
      name: "unknown email",
      response: await postJson("/api/auth/login", {
        email: `unknown-${runId}@example.test`,
        password: bidderPassword,
      }),
      status: 401,
    },
    {
      name: "malformed email",
      response: await postJson("/api/auth/login", {
        email: 42,
        password: bidderPassword,
      }),
      status: 400,
    },
    {
      name: "short password",
      response: await postJson("/api/auth/login", {
        email: bidderEmail,
        password: "short",
      }),
      status: 400,
    },
    {
      name: "unknown fields",
      response: await postJson("/api/auth/login", {
        email: bidderEmail,
        password: bidderPassword,
        accessToken: "not-allowed",
      }),
      status: 400,
    },
    {
      name: "wrong content type",
      response: await webRequest("/api/auth/login", {
        method: "POST",
        headers: {
          Origin: webOrigin,
          "Content-Type": "text/plain",
        },
        body: "email=test",
      }),
      status: 400,
    },
    {
      name: "oversized request",
      response: await postJson("/api/auth/login", {
        email: bidderEmail,
        password: bidderPassword,
        returnTo: "/auctions".padEnd(5000, "a"),
      }),
      status: 400,
    },
    {
      name: "missing origin",
      response: await webRequest("/api/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: bidderEmail,
          password: bidderPassword,
        }),
      }),
      status: 403,
    },
    {
      name: "mismatched origin",
      response: await postJson(
        "/api/auth/login",
        {
          email: bidderEmail,
          password: bidderPassword,
        },
        { Origin: "http://example.test" },
      ),
      status: 403,
    },
  ];

  for (const testCase of cases) {
    assert(
      testCase.response.status === testCase.status,
      `${testCase.name} returned ${testCase.response.status}`,
    );
    assertNoSetCookie(
      testCase.response,
      `${testCase.name} unexpectedly set a cookie`,
    );
    assertNoSensitiveText(testCase.response.text, testCase.name);
  }

  assert(
    cases[0].response.json?.message === cases[1].response.json?.message,
    "login failures revealed account existence",
  );

  console.log("ok - login failure handling passed");
}

async function runSuccessfulLoginTests() {
  const adminLogin = await login(adminEmail.toUpperCase(), adminPassword, "/admin");
  const bidderLogin = await login(bidderEmail, bidderPassword, "/auctions");

  assert(adminLogin.body.user.email === adminEmail, "admin email was not normalized");
  assert(adminLogin.body.user.role === "ADMIN", "admin role mismatch");
  assert(adminLogin.body.redirectTo === "/admin", "admin redirect mismatch");
  assert(bidderLogin.body.user.role === "BIDDER", "bidder role mismatch");
  assert(bidderLogin.body.redirectTo === "/auctions", "bidder redirect mismatch");

  console.log("ok - successful login handling passed");
  return { adminLogin, bidderLogin };
}

async function runSessionTests(bidderCookie) {
  const session = await webRequest("/api/auth/session", {
    headers: { Cookie: bidderCookie },
  });
  assert(session.status === 200, "valid session did not return 200");
  assert(session.json?.authenticated === true, "session response mismatch");
  assert(session.json?.user?.email === bidderEmail, "session user mismatch");
  assertNoSensitiveText(session.text, "session response");

  const missing = await webRequest("/api/auth/session");
  assert(missing.status === 401, "missing session did not return 401");

  const invalid = await webRequest("/api/auth/session", {
    headers: { Cookie: "auction_session=invalid.jwt.value" },
  });
  assert(invalid.status === 401, "invalid session did not return 401");
  assert(
    invalid.headers.get("set-cookie")?.includes("auction_session="),
    "invalid session did not delete stale cookie",
  );

  console.log("ok - session endpoint handling passed");
}

async function runProtectedRouteTests(adminCookie, bidderCookie) {
  const adminPage = await webRequest("/admin", {
    headers: { Cookie: adminCookie },
  });
  assert(adminPage.status === 200, "admin page did not render");
  assert(adminPage.text.includes(adminEmail), "admin page missing safe email");
  assertNoSensitiveText(adminPage.text, "admin page");

  const adminWrongRole = await webRequest("/auctions", {
    headers: { Cookie: adminCookie },
  });
  assertRedirect(adminWrongRole, "/admin");

  const bidderPage = await webRequest("/auctions", {
    headers: { Cookie: bidderCookie },
  });
  assert(bidderPage.status === 200, "bidder page did not render");
  assert(bidderPage.text.includes(bidderEmail), "bidder page missing safe email");
  assertNoSensitiveText(bidderPage.text, "bidder page");

  const bidderWrongRole = await webRequest("/admin", {
    headers: { Cookie: bidderCookie },
  });
  assertRedirect(bidderWrongRole, "/auctions");

  console.log("ok - protected routes and role redirects passed");
}

async function runSuspendedUserTest(client) {
  const suspendedLogin = await login(suspendedEmail, suspendedPassword, "/auctions");
  await client.query('UPDATE "User" SET "status" = $1 WHERE "id" = $2', [
    "SUSPENDED",
    suspendedId,
  ]);

  const session = await webRequest("/api/auth/session", {
    headers: { Cookie: suspendedLogin.cookie },
  });
  assert(session.status === 401, "suspended session did not return 401");
  assert(
    session.headers.get("set-cookie")?.includes("auction_session="),
    "suspended session did not delete stale cookie",
  );

  const protectedPage = await webRequest("/auctions", {
    headers: { Cookie: suspendedLogin.cookie },
  });
  assertRedirect(protectedPage, "/login");

  console.log("ok - suspended users lose frontend access");
}

async function runLogoutTests(bidderCookie) {
  const logout = await webRequest("/api/auth/logout", {
    method: "POST",
    headers: {
      Origin: webOrigin,
      Cookie: bidderCookie,
    },
  });
  assert(logout.status === 204, "logout did not return 204");
  assert(
    logout.headers.get("set-cookie")?.includes("auction_session="),
    "logout did not delete the session cookie",
  );

  const retry = await webRequest("/api/auth/logout", {
    method: "POST",
    headers: { Origin: webOrigin },
  });
  assert(retry.status === 204, "idempotent logout did not return 204");

  const crossOrigin = await webRequest("/api/auth/logout", {
    method: "POST",
    headers: { Origin: "http://example.test" },
  });
  assert(crossOrigin.status === 403, "cross-origin logout did not fail");

  const getLogout = await webRequest("/api/auth/logout");
  assert(getLogout.status !== 204, "GET logout was allowed");

  console.log("ok - logout handling passed");
}

function readFilesRecursively(directory) {
  if (!existsSync(directory)) {
    return [];
  }

  const files = [];
  for (const entry of readdirSync(directory)) {
    const path = resolve(directory, entry);
    const stat = statSync(path);

    if (stat.isDirectory()) {
      files.push(...readFilesRecursively(path));
    } else if (stat.isFile()) {
      files.push(path);
    }
  }

  return files;
}

function assertNoBrowserStorageUsage() {
  const sourceFiles = readFilesRecursively(resolve(webDirectory, "src"));
  const forbidden = [
    "localStorage",
    "sessionStorage",
    "IndexedDB",
    "indexedDB",
    "document.cookie",
  ];

  for (const file of sourceFiles) {
    const content = readFileSync(file, "utf8");
    for (const token of forbidden) {
      assert(!content.includes(token), `${file} uses ${token}`);
    }
  }

  console.log("ok - browser storage usage is absent");
}

function assertNoStaticLeakage(homeHtml) {
  const staticFiles = readFilesRecursively(resolve(webDirectory, ".next/static"));
  const searchable = [
    homeHtml,
    ...staticFiles.map((file) => readFileSync(file, "utf8")),
  ].join("\n");

  assertNoSensitiveText(searchable, "browser-delivered files");
  for (const forbidden of ["API_BASE_URL", "DATABASE_URL", "127.0.0.1:3112"]) {
    assert(!searchable.includes(forbidden), `browser bundle exposed ${forbidden}`);
  }

  console.log("ok - browser bundles do not expose authentication secrets");
}

function assertNoApplicationOutputLeakage(outputs) {
  for (const output of outputs) {
    assertNoSensitiveText(output.raw(), "application output");
  }

  console.log("ok - application output does not expose secrets");
}

async function main() {
  assert(databaseUrl, "DATABASE_URL is required for authentication verification");
  await assertTcpReachable(databaseUrl);
  console.log("ok - PostgreSQL TCP endpoint is reachable");

  await runCommand("npm", ["run", "build", "--workspace", "@auction/commitment"]);
  console.log("ok - shared commitment package builds");

  await runCommand("npm", ["run", "build", "--workspace", "apps/api"], {
    cwd: rootDirectory,
    env: createApiEnvironment(),
  });
  console.log("ok - NestJS application builds");

  await runCommand("npm", ["run", "build", "--workspace", "@auction/web"], {
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
    console.log("ok - temporary authentication users created");

    apiProcess = startProcess("node", ["dist/main.js"], {
      cwd: apiDirectory,
      env: createApiEnvironment(),
    });
    await waitForHttp("/api/health/live", apiPort, apiProcess.output, "API");
    console.log("ok - API started");

    webProcess = startProcess(
      "npm",
      [
        "run",
        "start",
        "--workspace",
        "@auction/web",
        "--",
        "-H",
        host,
        "-p",
        String(webPort),
      ],
      {
        cwd: rootDirectory,
        env: createWebEnvironment(),
      },
    );
    await waitForHttp("/", webPort, webProcess.output, "frontend");
    console.log("ok - frontend started");

    await runPublicPageTests();
    await runProxyTests();
    await runLoginFailureTests();
    const { adminLogin, bidderLogin } = await runSuccessfulLoginTests();
    await runSessionTests(bidderLogin.cookie);
    await runProtectedRouteTests(adminLogin.cookie, bidderLogin.cookie);
    await runSuspendedUserTest(client);
    await runLogoutTests(bidderLogin.cookie);

    const home = await webRequest("/");
    assertNoBrowserStorageUsage();
    assertNoStaticLeakage(home.text);
    assertNoApplicationOutputLeakage([apiProcess.output, webProcess.output]);
  } finally {
    if (client._connected) {
      await cleanupTemporaryUsers(client).catch(() => undefined);
      await client.end().catch(() => undefined);
    }
    if (webProcess) {
      await terminateChild(webProcess.child, webProcess.output, "frontend");
    }
    if (apiProcess) {
      await terminateChild(apiProcess.child, apiProcess.output, "API");
    }
  }

  console.log("ok - web authentication verification passed");
}

main().catch((error) => {
  console.error(sanitizeOutput(error instanceof Error ? error.message : String(error)));
  process.exitCode = 1;
});
