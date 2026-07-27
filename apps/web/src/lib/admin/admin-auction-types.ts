export type AuctionStatus = "DRAFT" | "PUBLISHED" | "CANCELLED" | "SETTLED";

export type AuctionPhase =
  | "DRAFT"
  | "SCHEDULED"
  | "COMMIT"
  | "REVEAL"
  | "ENDED"
  | "CANCELLED"
  | "SETTLED";

export interface AdminAuction {
  id: string;
  title: string;
  description: string | null;
  currency: string;
  startTime: string;
  revealTime: string;
  endTime: string;
  status: AuctionStatus;
  phase: AuctionPhase;
  createdById: string;
  version: number;
  settledAt: string | null;
  cancelledAt: string | null;
  cancellationReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PaginationMetadata {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface AdminAuctionListResponse {
  data: AdminAuction[];
  pagination: PaginationMetadata;
  serverTime: string;
}

export interface AdminAuctionDetailResponse {
  auction: AdminAuction;
  serverTime: string;
}

export interface SettlementSummary {
  totalBidCount: number;
  validRevealCount: number;
  invalidBidCount: number;
  winner: {
    bidId: string;
    bidderId: string;
    amountCents: string;
  } | null;
}

export interface AdminAuctionSettlementResponse {
  auction: {
    id: string;
    status: AuctionStatus;
    phase: AuctionPhase;
    version: number;
    settledAt: string;
  };
  summary: SettlementSummary;
  serverTime: string;
}

export interface AdminAuctionResultResponse {
  auction: {
    id: string;
    title: string;
    currency: string;
    status: AuctionStatus;
    phase: AuctionPhase;
    settledAt: string;
    version: number;
  };
  summary: {
    totalBidCount: number;
    validRevealCount: number;
    invalidBidCount: number;
    winner: {
      bidder: {
        id: string;
        email: string;
      };
      amountCents: string;
    } | null;
  };
  serverTime: string;
}

export interface CreateAuctionRequest {
  creationRequestId: string;
  title: string;
  description?: string | null;
  currency: string;
  startTime: string;
  revealTime: string;
  endTime: string;
}

export interface UpdateAuctionRequest {
  expectedVersion: number;
  title?: string;
  description?: string | null;
  currency?: string;
  startTime?: string;
  revealTime?: string;
  endTime?: string;
}

export interface PublishAuctionRequest {
  expectedVersion: number;
}

export interface CancelAuctionRequest {
  cancellationRequestId: string;
  expectedVersion: number;
  reason: string;
}

export interface SettleAuctionRequest {
  settlementRequestId: string;
  expectedVersion: number;
}
