import "reflect-metadata";
import { spawn } from "node:child_process";
import { randomBytes, randomUUID, createHmac } from "node:crypto";
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
const port = 3102;
const issuer = "auth-integration-issuer";
const audience = "auth-integration-audience";
const jwtSecret = randomBytes(32).toString("base64url");
const adminPassword = "AuthAdmin123!";
const bidderPassword = "AuthBidder123!";
const suspendedPassword = "AuthSuspended123!";
const runId = randomUUID();
const adminEmail = `auth-admin-${runId}@example.test`;
const bidderEmail = `auth-bidder-${runId}@example.test`;
const suspendedEmail = `auth-suspended-${runId}@example.test`;
const tempEmails = [adminEmail, bidderEmail, suspendedEmail];

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

  for (const secret of [databaseUrl, jwtSecret]) {
    if (secret) {
      sanitized = sanitized.split(secret).join("[REDACTED]");
    }
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
  if (!condition) {
    throw new Error(message);
  }
}

function wait(ms) {
  return new Promise((resolveWait) => setTimeout(resolveWait, ms));
}

function base64url(input) {
  return Buffer.from(input).toString("base64url");
}

function signToken(payload, secret = jwtSecret) {
  const header = {
    alg: "HS256",
    typ: "JWT",
  };
  const encodedHeader = base64url(JSON.stringify(header));
  const encodedPayload = base64url(JSON.stringify(payload));
  const signature = createHmac("sha256", secret)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest("base64url");

  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

function accessTokenFor(sub, overrides = {}, secret = jwtSecret) {
  const now = Math.floor(Date.now() / 1000);

  return signToken(
    {
      sub,
      type: "access",
      jti: randomUUID(),
      iat: now,
      exp: now + 900,
      iss: issuer,
      aud: audience,
      ...overrides,
    },
    secret,
  );
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

  return {
    statusCode: response.status,
    headers: response.headers,
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

  const result = await Promise.race([once(child, "close"), wait(5000)]);

  if (!Array.isArray(result)) {
    child.kill("SIGKILL");
    throw new Error(`API did not terminate after SIGTERM\n${getOutput()}`);
  }
}

async function createTestUsers(client) {
  await cleanupTestUsers(client);

  const users = [
    {
      id: randomUUID(),
      email: adminEmail,
      password: adminPassword,
      role: "ADMIN",
      status: "ACTIVE",
    },
    {
      id: randomUUID(),
      email: bidderEmail,
      password: bidderPassword,
      role: "BIDDER",
      status: "ACTIVE",
    },
    {
      id: randomUUID(),
      email: suspendedEmail,
      password: suspendedPassword,
      role: "BIDDER",
      status: "SUSPENDED",
    },
  ];

  for (const user of users) {
    const passwordHash = await argon2.hash(user.password, {
      type: argon2.argon2id,
    });

    await client.query(
      `
        INSERT INTO "User" ("id", "email", "passwordHash", "role", "status", "updatedAt")
        VALUES ($1, $2, $3, $4, $5, NOW())
      `,
      [user.id, user.email, passwordHash, user.role, user.status],
    );
  }

  return {
    adminId: users[0].id,
    bidderId: users[1].id,
    suspendedId: users[2].id,
  };
}

async function cleanupTestUsers(client) {
  await client.query('DELETE FROM "User" WHERE "email" = ANY($1)', [tempEmails]);
}

async function login(email, password, extra = undefined) {
  return requestJson("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({
      email,
      password,
      ...(extra ?? {}),
    }),
  });
}

function expectNoPasswordHash(value, label) {
  assert(
    !JSON.stringify(value).includes("passwordHash"),
    `${label} exposed passwordHash`,
  );
}

async function expectUnauthorized(label, request) {
  const response = await request();

  assert(response.statusCode === 401, `${label}: expected 401, got ${response.statusCode}`);

  return response;
}

async function verifyHttpAuth(client, ids) {
  const child = spawn(process.execPath, ["dist/main.js"], {
    cwd: apiDirectory,
    env: createEnvironment(),
    stdio: ["ignore", "pipe", "pipe"],
  });
  const getOutput = createOutputBuffer(child);

  try {
    await waitForStartup(child, getOutput);

    const live = await requestJson("/api/health/live");
    assert(live.statusCode === 200, "health liveness must remain public");

    const ready = await requestJson("/api/health/ready");
    assert(ready.statusCode === 200, "health readiness must remain public");

    const adminLogin = await login(adminEmail, adminPassword);
    assert(adminLogin.statusCode === 201, "administrator login should succeed");
    assert(adminLogin.body.tokenType === "Bearer", "administrator login token type mismatch");
    assert(adminLogin.body.expiresIn === 900, "administrator token ttl mismatch");
    assert(adminLogin.body.user.role === "ADMIN", "administrator role mismatch");
    expectNoPasswordHash(adminLogin.body, "administrator login response");

    const bidderLogin = await login(bidderEmail, bidderPassword);
    assert(bidderLogin.statusCode === 201, "bidder login should succeed");
    assert(bidderLogin.body.user.role === "BIDDER", "bidder role mismatch");
    expectNoPasswordHash(bidderLogin.body, "bidder login response");

    const normalizedLogin = await login(`  ${bidderEmail.toUpperCase()}  `, bidderPassword);
    assert(normalizedLogin.statusCode === 201, "email normalization login should succeed");

    const wrongPassword = await expectUnauthorized("wrong password", () =>
      login(adminEmail, "WrongPassword123!"),
    );
    const unknownEmail = await expectUnauthorized("unknown email", () =>
      login(`missing-${runId}@example.test`, "WrongPassword123!"),
    );
    assert(
      wrongPassword.body?.message === unknownEmail.body?.message,
      "wrong password and unknown email messages must match",
    );

    await expectUnauthorized("missing token", () => requestJson("/api/auth/me"));
    await expectUnauthorized("malformed bearer header", () =>
      requestJson("/api/auth/me", {
        headers: {
          Authorization: "Bearer",
        },
      }),
    );
    await expectUnauthorized("invalid signature", () =>
      requestJson("/api/auth/me", {
        headers: {
          Authorization: `Bearer ${accessTokenFor(ids.adminId, {}, "wrong-secret")}`,
        },
      }),
    );
    await expectUnauthorized("wrong issuer", () =>
      requestJson("/api/auth/me", {
        headers: {
          Authorization: `Bearer ${accessTokenFor(ids.adminId, { iss: "wrong-issuer" })}`,
        },
      }),
    );
    await expectUnauthorized("wrong audience", () =>
      requestJson("/api/auth/me", {
        headers: {
          Authorization: `Bearer ${accessTokenFor(ids.adminId, { aud: "wrong-audience" })}`,
        },
      }),
    );
    await expectUnauthorized("expired token", () =>
      requestJson("/api/auth/me", {
        headers: {
          Authorization: `Bearer ${accessTokenFor(ids.adminId, {
            exp: Math.floor(Date.now() / 1000) - 60,
          })}`,
        },
      }),
    );

    const me = await requestJson("/api/auth/me", {
      headers: {
        Authorization: `Bearer ${adminLogin.body.accessToken}`,
      },
    });
    assert(me.statusCode === 200, `/me with valid token expected 200, got ${me.statusCode}`);
    assert(me.body.email === adminEmail, "/me returned unexpected user");
    expectNoPasswordHash(me.body, "/me response");

    const suspendedLogin = await expectUnauthorized("suspended login", () =>
      login(suspendedEmail, suspendedPassword),
    );
    assert(
      suspendedLogin.body?.message === wrongPassword.body?.message,
      "suspended login must use safe auth message",
    );

    await client.query('UPDATE "User" SET "status" = $1, "updatedAt" = NOW() WHERE "id" = $2', [
      "SUSPENDED",
      ids.bidderId,
    ]);

    await expectUnauthorized("suspended existing access", () =>
      requestJson("/api/auth/me", {
        headers: {
          Authorization: `Bearer ${bidderLogin.body.accessToken}`,
        },
      }),
    );

    await expectUnauthorized("unknown token user", () =>
      requestJson("/api/auth/me", {
        headers: {
          Authorization: `Bearer ${accessTokenFor(randomUUID())}`,
        },
      }),
    );

    const unexpectedProperty = await login(adminEmail, adminPassword, {
      unexpected: true,
    });
    assert(
      unexpectedProperty.statusCode === 400,
      `unexpected login property expected 400, got ${unexpectedProperty.statusCode}`,
    );

    const invalidEmail = await login("not-an-email", adminPassword);
    assert(invalidEmail.statusCode === 400, "invalid email format expected 400");

    const shortPassword = await login(adminEmail, "short");
    assert(shortPassword.statusCode === 400, "short password expected 400");

    await terminateChild(child, getOutput);
    console.log("ok - HTTP authentication integration passed");
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
    }
  }
}

function createMockExecutionContext(handler, controller, user) {
  return {
    getHandler: () => handler,
    getClass: () => controller,
    switchToHttp: () => ({
      getRequest: () => ({ user }),
    }),
  };
}

async function verifyRolesGuard() {
  const [{ Reflector }, { RolesGuard }, { ROLES_KEY }, { UserRole }] =
    await Promise.all([
      import("@nestjs/core"),
      import("../dist/auth/guards/roles.guard.js"),
      import("../dist/auth/decorators/roles.decorator.js"),
      import("../dist/generated/prisma/enums.js"),
    ]);

  const reflector = new Reflector();
  const guard = new RolesGuard(reflector);
  const controller = class TestController {};
  const handler = () => undefined;
  const unprotectedHandler = () => undefined;
  const admin = { role: UserRole.ADMIN };
  const bidder = { role: UserRole.BIDDER };

  Reflect.defineMetadata(ROLES_KEY, [UserRole.ADMIN], handler);

  assert(
    guard.canActivate(createMockExecutionContext(handler, controller, admin)),
    "ADMIN should satisfy ADMIN",
  );

  try {
    guard.canActivate(createMockExecutionContext(handler, controller, bidder));
    throw new Error("BIDDER should fail ADMIN");
  } catch (error) {
    assert(error?.constructor?.name === "ForbiddenException", "BIDDER should fail with ForbiddenException");
  }

  Reflect.defineMetadata(ROLES_KEY, [UserRole.BIDDER], handler);

  assert(
    guard.canActivate(createMockExecutionContext(handler, controller, bidder)),
    "BIDDER should satisfy BIDDER",
  );

  assert(
    guard.canActivate(createMockExecutionContext(unprotectedHandler, controller, undefined)),
    "Routes without roles should pass",
  );

  try {
    guard.canActivate(createMockExecutionContext(handler, controller, undefined));
    throw new Error("Missing authenticated user should fail protected roles");
  } catch (error) {
    assert(
      error?.constructor?.name === "ForbiddenException",
      "Missing authenticated user should fail with ForbiddenException",
    );
  }

  console.log("ok - RolesGuard direct verification passed");
}

assert(databaseUrl, "DATABASE_URL is required for auth integration verification");

const client = new Client({ connectionString: databaseUrl });

try {
  await runCommand("npm", ["run", "build"]);
  console.log("ok - NestJS application builds");

  await client.connect();
  const ids = await createTestUsers(client);

  await verifyHttpAuth(client, ids);
  await verifyRolesGuard();

  console.log("ok - auth integration verification passed");
} finally {
  if (client._connected) {
    await cleanupTestUsers(client).catch(() => undefined);
    await client.end();
  }
}
