import {
  COMMITMENT_PROTOCOL_VERSION,
  computeBidCommitmentV1,
  validateAmountCents,
  validateCommitmentHash,
  validateSecret,
  normalizeCurrency,
  normalizeUuid,
} from "@auction/commitment";

import type { AuthenticatedUser } from "@/lib/auth/auth-types";

import type {
  BidCommitmentResponse,
  BidderAuction,
  RevealReceipt,
} from "./bidder-auction-types";

export const receiptMismatchMessage = "This receipt does not match this auction";

export function createRevealReceipt({
  auction,
  user,
  amountCents,
  secret,
  commitmentHash,
  response,
}: {
  auction: BidderAuction;
  user: AuthenticatedUser;
  amountCents: string;
  secret: string;
  commitmentHash: string;
  response: BidCommitmentResponse;
}): RevealReceipt {
  return {
    format: "auction-bid-reveal-receipt",
    receiptVersion: 1,
    protocolVersion: COMMITMENT_PROTOCOL_VERSION,
    auctionId: auction.id,
    bidderId: user.id,
    currency: auction.currency,
    amountCents,
    secret,
    commitmentHash,
    bidId: response.bid.id,
    bidVersion: response.bid.version,
    committedAt: response.commitment.committedAt,
    createdAt: new Date().toISOString(),
  };
}

export function serializeRevealReceipt(receipt: RevealReceipt): string {
  return `${JSON.stringify(receipt, null, 2)}\n`;
}

export function parseRevealReceipt(value: string): RevealReceipt {
  try {
    return validateRevealReceipt(JSON.parse(value) as unknown);
  } catch {
    throw new Error(receiptMismatchMessage);
  }
}

export async function validateRevealReceiptForAuction({
  receipt,
  auction,
  user,
  activeCommitmentHash,
}: {
  receipt: RevealReceipt;
  auction: BidderAuction;
  user: AuthenticatedUser;
  activeCommitmentHash: string | null;
}): Promise<RevealReceipt> {
  if (
    receipt.auctionId !== auction.id ||
    receipt.bidderId !== user.id ||
    receipt.currency !== auction.currency ||
    (activeCommitmentHash && receipt.commitmentHash !== activeCommitmentHash)
  ) {
    throw new Error(receiptMismatchMessage);
  }

  const computed = await computeBidCommitmentV1({
    auctionId: receipt.auctionId,
    bidderId: receipt.bidderId,
    currency: receipt.currency,
    amountCents: receipt.amountCents,
    secret: receipt.secret,
  });

  if (computed !== receipt.commitmentHash) {
    throw new Error(receiptMismatchMessage);
  }

  return receipt;
}

export function downloadRevealReceipt(receipt: RevealReceipt) {
  const blob = new Blob([serializeRevealReceipt(receipt)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `auction-${receipt.auctionId}-reveal-receipt.json`;
  anchor.rel = "noreferrer";
  anchor.click();
  URL.revokeObjectURL(url);
}

export async function copyRevealReceipt(receipt: RevealReceipt): Promise<void> {
  await navigator.clipboard.writeText(serializeRevealReceipt(receipt));
}

function validateRevealReceipt(value: unknown): RevealReceipt {
  if (!isRecord(value)) throw new Error(receiptMismatchMessage);
  if (value.format !== "auction-bid-reveal-receipt" || value.receiptVersion !== 1) {
    throw new Error(receiptMismatchMessage);
  }
  return {
    format: "auction-bid-reveal-receipt",
    receiptVersion: 1,
    protocolVersion: validateProtocol(value.protocolVersion),
    auctionId: normalizeUuid(parseString(value.auctionId), "auctionId"),
    bidderId: normalizeUuid(parseString(value.bidderId), "bidderId"),
    currency: normalizeCurrency(parseString(value.currency)),
    amountCents: validateAmountCents(parseString(value.amountCents)),
    secret: validateSecret(parseString(value.secret)),
    commitmentHash: validateCommitmentHash(parseString(value.commitmentHash)),
    bidId: normalizeUuid(parseString(value.bidId), "bidId"),
    bidVersion: parseNonnegativeInteger(value.bidVersion),
    committedAt: parseIsoDate(value.committedAt),
    createdAt: parseIsoDate(value.createdAt),
  };
}

function validateProtocol(value: unknown): 1 {
  if (value !== COMMITMENT_PROTOCOL_VERSION) throw new Error(receiptMismatchMessage);
  return COMMITMENT_PROTOCOL_VERSION;
}

function parseString(value: unknown): string {
  if (typeof value !== "string") throw new Error(receiptMismatchMessage);
  return value;
}

function parseNonnegativeInteger(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new Error(receiptMismatchMessage);
  }
  return value;
}

function parseIsoDate(value: unknown): string {
  const stringValue = parseString(value);
  if (Number.isNaN(Date.parse(stringValue))) throw new Error(receiptMismatchMessage);
  return stringValue;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
