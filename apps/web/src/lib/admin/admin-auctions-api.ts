import "server-only";

import { ApiError } from "@/lib/api/api-error";
import { serverApiRequest } from "@/lib/api/server-api-client";
import { getSessionToken } from "@/lib/auth/session-cookie";

import type {
  AdminAuctionDetailResponse,
  AdminAuctionListResponse,
  AdminAuctionResultResponse,
  AdminAuctionSettlementResponse,
  AuctionStatus,
  CancelAuctionRequest,
  CreateAuctionRequest,
  PublishAuctionRequest,
  SettleAuctionRequest,
  UpdateAuctionRequest,
} from "./admin-auction-types";
import {
  validateAdminAuctionDetailResponse,
  validateAdminAuctionListResponse,
  validateAdminAuctionResultResponse,
  validateAdminAuctionSettlementResponse,
} from "./admin-auction-validation";

export async function listAdminAuctions({
  page = 1,
  limit = 20,
  status,
}: {
  page?: number;
  limit?: number;
  status?: AuctionStatus;
} = {}): Promise<AdminAuctionListResponse> {
  const params = new URLSearchParams({
    page: String(page),
    limit: String(limit),
  });
  if (status) params.set("status", status);

  const response = await authenticatedRequest<unknown>(
    `/admin/auctions?${params.toString()}`,
  );
  return validateAdminAuctionListResponse(response);
}

export async function getAdminAuction(
  auctionId: string,
): Promise<AdminAuctionDetailResponse> {
  const response = await authenticatedRequest<unknown>(
    `/admin/auctions/${auctionId}`,
  );
  return validateAdminAuctionDetailResponse(response);
}

export async function createAdminAuction(
  request: CreateAuctionRequest,
): Promise<AdminAuctionDetailResponse> {
  const response = await authenticatedRequest<unknown>("/admin/auctions", {
    method: "POST",
    body: request,
  });
  return validateAdminAuctionDetailResponse(response);
}

export async function updateAdminAuction(
  auctionId: string,
  request: UpdateAuctionRequest,
): Promise<AdminAuctionDetailResponse> {
  const response = await authenticatedRequest<unknown>(
    `/admin/auctions/${auctionId}`,
    {
      method: "PATCH",
      body: request,
    },
  );
  return validateAdminAuctionDetailResponse(response);
}

export async function publishAdminAuction(
  auctionId: string,
  request: PublishAuctionRequest,
): Promise<AdminAuctionDetailResponse> {
  const response = await authenticatedRequest<unknown>(
    `/admin/auctions/${auctionId}/publish`,
    {
      method: "POST",
      body: request,
    },
  );
  return validateAdminAuctionDetailResponse(response);
}

export async function cancelAdminAuction(
  auctionId: string,
  request: CancelAuctionRequest,
): Promise<AdminAuctionDetailResponse> {
  const response = await authenticatedRequest<unknown>(
    `/admin/auctions/${auctionId}/cancel`,
    {
      method: "POST",
      body: request,
    },
  );
  return validateAdminAuctionDetailResponse(response);
}

export async function settleAdminAuction(
  auctionId: string,
  request: SettleAuctionRequest,
): Promise<AdminAuctionSettlementResponse> {
  const response = await authenticatedRequest<unknown>(
    `/admin/auctions/${auctionId}/settle`,
    {
      method: "POST",
      body: request,
    },
  );
  return validateAdminAuctionSettlementResponse(response);
}

export async function getAdminAuctionResults(
  auctionId: string,
): Promise<AdminAuctionResultResponse> {
  const response = await authenticatedRequest<unknown>(
    `/admin/auctions/${auctionId}/results`,
  );
  return validateAdminAuctionResultResponse(response);
}

async function authenticatedRequest<TResponse>(
  path: string,
  options: {
    method?: "GET" | "POST" | "PATCH" | "DELETE";
    body?: unknown;
  } = {},
): Promise<TResponse | null> {
  const token = await getSessionToken();

  if (!token) {
    throw new ApiError({
      status: 401,
      code: "AUTHENTICATION_REQUIRED",
      message: "Authentication required",
    });
  }

  return serverApiRequest<TResponse>(path, {
    ...options,
    accessToken: token,
  });
}
