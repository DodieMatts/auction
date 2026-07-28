import { randomUUID } from "node:crypto";
import argon2 from "argon2";

import type { DatabaseClient } from "./database";
import { createEmail } from "./test-identifiers";

export type TestRole = "ADMIN" | "BIDDER";

export interface TestUser {
  id: string;
  email: string;
  password: string;
  role: TestRole;
}

export async function createTestUser(
  client: DatabaseClient,
  namespace: string,
  label: string,
  role: TestRole,
): Promise<TestUser> {
  const user: TestUser = {
    id: randomUUID(),
    email: createEmail(namespace, label),
    password: `E2e${label}Password123!`,
    role,
  };
  const passwordHash = await argon2.hash(user.password, { type: argon2.argon2id });
  await client.query(
    `INSERT INTO "User" (
      "id", "email", "passwordHash", "role", "status", "createdAt", "updatedAt"
    )
    VALUES ($1, $2, $3, $4, 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    [user.id, user.email, passwordHash, role],
  );
  return user;
}

export async function suspendTestUser(client: DatabaseClient, userId: string): Promise<void> {
  await client.query(
    `UPDATE "User" SET "status" = 'SUSPENDED', "updatedAt" = CURRENT_TIMESTAMP WHERE "id" = $1`,
    [userId],
  );
}

export async function deleteTestUser(client: DatabaseClient, userId: string): Promise<void> {
  await client.query(`DELETE FROM "User" WHERE "id" = $1`, [userId]);
}
