import type { AuctionPhase, AuctionStatus } from "./admin-auction-types";

type Tone = "success" | "warning" | "danger" | "neutral";

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
});

export function formatAuctionDateTime(value: string | null): string {
  if (!value) return "Not set";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Invalid date";
  return dateFormatter.format(date);
}

export function formatAuctionMoney(amountCents: string, currency: string): string {
  try {
    const cents = BigInt(amountCents);
    const major = cents / BigInt(100);
    const minor = cents % BigInt(100);
    const formatted = `${major.toString()}.${minor.toString().padStart(2, "0")}`;
    if (major > BigInt(Number.MAX_SAFE_INTEGER)) {
      return `${currency} ${formatted}`;
    }
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
    }).format(Number(formatted));
  } catch {
    return `${amountCents} ${currency}`;
  }
}

export function formatAuctionStatus(status: AuctionStatus): string {
  return titleCase(status);
}

export function formatAuctionPhase(phase: AuctionPhase): string {
  if (phase === "COMMIT") return "Commit";
  return titleCase(phase);
}

export function getAuctionStatusTone(statusOrPhase: AuctionStatus | AuctionPhase): Tone {
  switch (statusOrPhase) {
    case "PUBLISHED":
    case "COMMIT":
    case "SETTLED":
      return "success";
    case "SCHEDULED":
    case "REVEAL":
    case "ENDED":
      return "warning";
    case "CANCELLED":
      return "danger";
    case "DRAFT":
    default:
      return "neutral";
  }
}

function titleCase(value: string): string {
  return value
    .toLowerCase()
    .split("_")
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}
