import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";

const { Client } = pg;

export type DatabaseClient = InstanceType<typeof Client>;

export function parseEnvFile(path: string): Record<string, string> {
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

export function getDatabaseUrl(): string {
  const apiEnv = parseEnvFile(resolve(process.cwd(), "../api/.env"));
  const databaseUrl = process.env.DATABASE_URL ?? apiEnv.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required for E2E tests");
  return databaseUrl;
}

export async function createDatabaseClient(): Promise<DatabaseClient> {
  const client = new Client({ connectionString: getDatabaseUrl() });
  await client.connect();
  return client;
}

export async function cleanupTestNamespace(
  client: DatabaseClient,
  namespace: string,
): Promise<void> {
  const users = await client.query<{ id: string }>(
    `SELECT "id" FROM "User" WHERE "email" LIKE $1`,
    [`${namespace}-%@example.test`],
  );
  const userIds = users.rows.map((row) => row.id);
  const auctions = await client.query<{ id: string }>(
    `SELECT "id" FROM "Auction" WHERE "title" LIKE $1 OR "createdById" = ANY($2::uuid[])`,
    [`${namespace}%`, userIds],
  );
  const auctionIds = auctions.rows.map((row) => row.id);
  const bids = await client.query<{ id: string }>(
    `SELECT "id" FROM "Bid"
     WHERE "bidderId" = ANY($1::uuid[])
        OR (${auctionIds.length > 0 ? `"auctionId" = ANY($2::uuid[])` : "false"})`,
    auctionIds.length > 0 ? [userIds, auctionIds] : [userIds],
  );
  const bidIds = bids.rows.map((row) => row.id);

  if (bidIds.length > 0) {
    await client.query(`DELETE FROM "BidRevealAttempt" WHERE "bidId" = ANY($1::uuid[])`, [
      bidIds,
    ]);
    await client.query(`DELETE FROM "BidCommitment" WHERE "bidId" = ANY($1::uuid[])`, [
      bidIds,
    ]);
    await client.query(`DELETE FROM "Bid" WHERE "id" = ANY($1::uuid[])`, [bidIds]);
  }
  if (auctionIds.length > 0) {
    await client.query(`DELETE FROM "Auction" WHERE "id" = ANY($1::uuid[])`, [auctionIds]);
  }
  if (userIds.length > 0) {
    await client.query(`DELETE FROM "User" WHERE "id" = ANY($1::uuid[])`, [userIds]);
  }
}
