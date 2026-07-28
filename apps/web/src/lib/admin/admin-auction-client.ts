import type {
  CancelAuctionRequest,
  CreateAuctionRequest,
  PublishAuctionRequest,
  SettleAuctionRequest,
  UpdateAuctionRequest,
} from "./admin-auction-types";

export class AdminAuctionClientError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "AdminAuctionClientError";
    this.status = status;
  }
}

export async function createAuction(request: CreateAuctionRequest) {
  return adminRequest("/api/admin/auctions", {
    method: "POST",
    body: request,
  });
}

export async function updateAuction(auctionId: string, request: UpdateAuctionRequest) {
  return adminRequest(`/api/admin/auctions/${auctionId}`, {
    method: "PATCH",
    body: request,
  });
}

export async function publishAuction(
  auctionId: string,
  request: PublishAuctionRequest,
) {
  return adminRequest(`/api/admin/auctions/${auctionId}/publish`, {
    method: "POST",
    body: request,
  });
}

export async function cancelAuction(
  auctionId: string,
  request: CancelAuctionRequest,
) {
  return adminRequest(`/api/admin/auctions/${auctionId}/cancel`, {
    method: "POST",
    body: request,
  });
}

export async function settleAuction(
  auctionId: string,
  request: SettleAuctionRequest,
) {
  return adminRequest(`/api/admin/auctions/${auctionId}/settle`, {
    method: "POST",
    body: request,
  });
}

async function adminRequest(
  path: string,
  options: {
    method: "POST" | "PATCH";
    body: unknown;
  },
) {
  const response = await fetch(path, {
    method: options.method,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(options.body),
    cache: "no-store",
    credentials: "same-origin",
  });
  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    throw new AdminAuctionClientError(
      response.status,
      parseErrorMessage(payload, response.status),
    );
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

  if (status === 409) {
    return "This auction changed elsewhere. Refresh before retrying.";
  }

  if (status === 401) {
    return "Your session expired. Sign in again.";
  }

  if (status === 503) {
    return "Auction service is unavailable.";
  }

  return "Auction request failed.";
}
