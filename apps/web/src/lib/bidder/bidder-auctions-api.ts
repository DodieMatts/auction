import "server-only";

import { ApiError } from "@/lib/api/api-error";
import { serverApiRequest } from "@/lib/api/server-api-client";
import { getSessionToken } from "@/lib/auth/session-cookie";

import type {
  BidderAuctionDetailResponse,
  BidderAuctionListResponse,
  BidderAuctionResultResponse,
  BidCommitmentResponse,
  BidParticipationResponse,
  BidRevealResponse,
  BidRevealStatusResponse,
  SubmitCommitmentRequest,
  SubmitRevealRequest,
} from "./bidder-auction-types";
import {
  validateBidCommitmentResponse,
  validateBidParticipationResponse,
  validateBidRevealResponse,
  validateBidRevealStatusResponse,
  validateBidderAuctionDetailResponse,
  validateBidderAuctionListResponse,
  validateBidderAuctionResultResponse,
} from "./bidder-auction-validation";

export async function listBidderAuctions({
  page = 1,
  limit = 20,
}: {
  page?: number;
  limit?: number;
} = {}): Promise<BidderAuctionListResponse> {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) });
  return validateBidderAuctionListResponse(
    await authenticatedRequest(`/auctions?${params.toString()}`),
  );
}

export async function getBidderAuction(
  auctionId: string,
): Promise<BidderAuctionDetailResponse> {
  return validateBidderAuctionDetailResponse(
    await authenticatedRequest(`/auctions/${auctionId}`),
  );
}

export async function getBidParticipation(
  auctionId: string,
): Promise<BidParticipationResponse> {
  return validateBidParticipationResponse(
    await authenticatedRequest(`/auctions/${auctionId}/participation`),
  );
}

export async function submitBidCommitment(
  auctionId: string,
  request: SubmitCommitmentRequest,
): Promise<BidCommitmentResponse> {
  return validateBidCommitmentResponse(
    await authenticatedRequest(`/auctions/${auctionId}/commitments`, {
      method: "POST",
      body: request,
    }),
  );
}

export async function getBidRevealStatus(
  auctionId: string,
): Promise<BidRevealStatusResponse> {
  return validateBidRevealStatusResponse(
    await authenticatedRequest(`/auctions/${auctionId}/reveal-status`),
  );
}

export async function submitBidReveal(
  auctionId: string,
  request: SubmitRevealRequest,
): Promise<BidRevealResponse> {
  return validateBidRevealResponse(
    await authenticatedRequest(`/auctions/${auctionId}/reveals`, {
      method: "POST",
      body: request,
    }),
  );
}

export async function getBidderAuctionResults(
  auctionId: string,
): Promise<BidderAuctionResultResponse> {
  return validateBidderAuctionResultResponse(
    await authenticatedRequest(`/auctions/${auctionId}/results`),
  );
}

async function authenticatedRequest(
  path: string,
  options: {
    method?: "GET" | "POST" | "PATCH" | "DELETE";
    body?: unknown;
  } = {},
): Promise<unknown> {
  const token = await getSessionToken();
  if (!token) {
    throw new ApiError({
      status: 401,
      code: "AUTHENTICATION_REQUIRED",
      message: "Authentication required",
    });
  }
  return serverApiRequest<unknown>(path, { ...options, accessToken: token });
}
