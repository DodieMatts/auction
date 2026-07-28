import type { DatabaseClient } from "./database";

export async function moveAuctionToCommitPhase(
  client: DatabaseClient,
  auctionId: string,
): Promise<void> {
  const now = Date.now();
  await updateTimes(client, auctionId, {
    startTime: new Date(now - 5 * 60_000),
    revealTime: new Date(now + 10 * 60_000),
    endTime: new Date(now + 20 * 60_000),
  });
}

export async function moveAuctionToRevealPhase(
  client: DatabaseClient,
  auctionId: string,
): Promise<void> {
  const now = Date.now();
  await updateTimes(client, auctionId, {
    startTime: new Date(now - 20 * 60_000),
    revealTime: new Date(now - 5 * 60_000),
    endTime: new Date(now + 10 * 60_000),
  });
}

export async function moveAuctionToEndedPhase(
  client: DatabaseClient,
  auctionId: string,
): Promise<void> {
  const now = Date.now();
  await updateTimes(client, auctionId, {
    startTime: new Date(now - 30 * 60_000),
    revealTime: new Date(now - 20 * 60_000),
    endTime: new Date(now - 5 * 60_000),
  });
}

async function updateTimes(
  client: DatabaseClient,
  auctionId: string,
  times: { startTime: Date; revealTime: Date; endTime: Date },
): Promise<void> {
  await client.query(
    `UPDATE "Auction"
     SET "startTime" = $2, "revealTime" = $3, "endTime" = $4, "updatedAt" = CURRENT_TIMESTAMP
     WHERE "id" = $1`,
    [auctionId, times.startTime, times.revealTime, times.endTime],
  );
}
