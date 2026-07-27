import { randomUUID } from "node:crypto";

import type { DatabaseClient } from "./database";
import { createTitle } from "./test-identifiers";

export interface TestAuction {
  id: string;
  title: string;
}

export async function createTestAuction(
  client: DatabaseClient,
  input: {
    namespace: string;
    label: string;
    adminId: string;
    status?: "DRAFT" | "PUBLISHED" | "CANCELLED" | "SETTLED";
    startTime?: Date;
    revealTime?: Date;
    endTime?: Date;
    settledAt?: Date | null;
  },
): Promise<TestAuction> {
  const id = randomUUID();
  const title = createTitle(input.namespace, input.label);
  const now = Date.now();
  const startTime = input.startTime ?? new Date(now + 60 * 60_000);
  const revealTime = input.revealTime ?? new Date(now + 120 * 60_000);
  const endTime = input.endTime ?? new Date(now + 180 * 60_000);
  const status = input.status ?? "DRAFT";
  await client.query(
    `INSERT INTO "Auction" (
      "id", "creationRequestId", "title", "description", "currency", "startTime",
      "revealTime", "endTime", "status", "createdById", "settledAt",
      "cancelledAt", "cancellationRequestId", "cancellationReason", "createdAt", "updatedAt"
    )
    VALUES (
      $1, $2, $3, $4, 'USD', $5, $6, $7, $8, $9, $10,
      $11, $12, $13, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    )`,
    [
      id,
      randomUUID(),
      title,
      `${title} description`,
      startTime,
      revealTime,
      endTime,
      status,
      input.adminId,
      input.settledAt ?? null,
      status === "CANCELLED" ? new Date() : null,
      status === "CANCELLED" ? randomUUID() : null,
      status === "CANCELLED" ? "E2E cancellation" : null,
    ],
  );
  return { id, title };
}

export async function findAuctionByTitle(
  client: DatabaseClient,
  title: string,
): Promise<{ id: string; version: number; status: string } | null> {
  const result = await client.query<{ id: string; version: number; status: string }>(
    `SELECT "id", "version", "status" FROM "Auction" WHERE "title" = $1`,
    [title],
  );
  return result.rows[0] ?? null;
}
