import type { SubmitCommitmentRequest, SubmitRevealRequest } from "./bidder-auction-types";

export class BidderAuctionClientError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "BidderAuctionClientError";
    this.status = status;
  }
}

export async function submitCommitment(
  auctionId: string,
  request: SubmitCommitmentRequest,
) {
  return bidderRequest(`/api/auctions/${auctionId}/commitments`, {
    method: "POST",
    body: request,
  });
}

export async function loadParticipation(auctionId: string) {
  return bidderRequest(`/api/auctions/${auctionId}/participation`);
}

export async function submitReveal(auctionId: string, request: SubmitRevealRequest) {
  return bidderRequest(`/api/auctions/${auctionId}/reveals`, {
    method: "POST",
    body: request,
  });
}

export async function loadRevealStatus(auctionId: string) {
  return bidderRequest(`/api/auctions/${auctionId}/reveal-status`);
}

export async function loadResults(auctionId: string) {
  return bidderRequest(`/api/auctions/${auctionId}/results`);
}

async function bidderRequest(
  path: string,
  options: {
    method?: "GET" | "POST";
    body?: unknown;
  } = {},
) {
  const response = await fetch(path, {
    method: options.method ?? "GET",
    headers: {
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
    cache: "no-store",
    credentials: "same-origin",
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new BidderAuctionClientError(response.status, parseErrorMessage(payload, response.status));
  }
  return payload;
}

function parseErrorMessage(payload: unknown, status: number): string {
  if (
    payload &&
    typeof payload === "object" &&
    "message" in payload &&
    typeof payload.message === "string"
  ) {
    return payload.message;
  }
  if (status === 401) return "Your session expired. Sign in again.";
  if (status === 409) return "Your bid state changed. Refresh before retrying.";
  if (status === 422) return "The receipt does not match the active commitment.";
  if (status === 503) return "Auction service is unavailable.";
  return "Auction request failed.";
}
