import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

export interface RevealReceipt {
  format: "auction-bid-reveal-receipt";
  receiptVersion: 1;
  protocolVersion: 1;
  auctionId: string;
  bidderId: string;
  currency: string;
  amountCents: string;
  secret: string;
  commitmentHash: string;
  bidId: string;
  bidVersion: number;
  committedAt: string;
  createdAt: string;
}

export async function createReceiptTempDirectory(): Promise<string> {
  const directory = join(tmpdir(), `auction-e2e-receipts-${randomUUID()}`);
  await mkdir(directory, { recursive: true });
  return directory;
}

export async function writeReceiptFile(directory: string, receipt: RevealReceipt): Promise<string> {
  const path = join(directory, `receipt-${randomUUID()}.json`);
  await writeFile(path, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  return path;
}

export async function readReceiptFile(path: string): Promise<RevealReceipt> {
  return JSON.parse(await readFile(path, "utf8")) as RevealReceipt;
}

export async function removeReceiptTempDirectory(directory: string): Promise<void> {
  await rm(directory, { recursive: true, force: true });
}
