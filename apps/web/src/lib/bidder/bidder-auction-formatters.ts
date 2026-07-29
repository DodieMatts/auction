import type { AuctionPhase, BidderAuctionOutcome } from "./bidder-auction-types";
import { formatLocalDateTime } from "../date-time";

export type StatusTone = "success" | "warning" | "danger" | "neutral";

export function formatAuctionDateTime(value: string): string {
  return formatLocalDateTime(value);
}

export function formatAuctionMoney(amountCents: string, currency: string): string {
  try {
    const cents = BigInt(amountCents);
    const major = cents / BigInt(100);
    const minor = cents % BigInt(100);
    if (major > BigInt(Number.MAX_SAFE_INTEGER)) {
      return `${currency} ${major.toString()}.${minor.toString().padStart(2, "0")}`;
    }
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
    }).format(Number(major) + Number(minor) / 100);
  } catch {
    return `${currency} ${amountCents}`;
  }
}

export function formatAuctionPhase(phase: AuctionPhase): string {
  switch (phase) {
    case "SCHEDULED":
      return "Scheduled";
    case "COMMIT":
      return "Commit";
    case "REVEAL":
      return "Reveal";
    case "ENDED":
      return "Ended";
    case "SETTLED":
      return "Settled";
  }
}

export function getPhaseTone(phase: AuctionPhase): StatusTone {
  switch (phase) {
    case "COMMIT":
    case "SETTLED":
      return "success";
    case "SCHEDULED":
    case "REVEAL":
      return "warning";
    case "ENDED":
      return "neutral";
  }
}

export function getOutcomeTone(outcome: BidderAuctionOutcome): StatusTone {
  switch (outcome) {
    case "WON":
      return "success";
    case "LOST":
      return "warning";
    case "INVALID":
      return "danger";
    case "NOT_PARTICIPATED":
      return "neutral";
  }
}

export function formatOutcome(outcome: BidderAuctionOutcome): string {
  switch (outcome) {
    case "NOT_PARTICIPATED":
      return "Not participated";
    case "WON":
      return "Won";
    case "LOST":
      return "Lost";
    case "INVALID":
      return "Invalid";
  }
}
