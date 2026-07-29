export type AuctionPhase = "SCHEDULED" | "COMMIT" | "REVEAL" | "ENDED" | "SETTLED";

export type AuctionStatus = "PUBLISHED" | "SETTLED";

export type BidStatus = "COMMITTED" | "REVEALED" | "INVALID" | "WON" | "LOST";

export type RevealValidationStatus = "PENDING" | "VALID" | "INVALID";

export type BidderAuctionOutcome = "NOT_PARTICIPATED" | "WON" | "LOST" | "INVALID";

export type BidInvalidReason =
  | "NOT_REVEALED"
  | "COMMITMENT_MISMATCH"
  | "REPLACED_RECEIPT"
  | "REVEAL_NOT_ACCEPTED";

export interface PaginationMetadata {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface BidderAuction {
  id: string;
  title: string;
  description: string | null;
  currency: string;
  startTime: string;
  revealTime: string;
  endTime: string;
  status: AuctionStatus;
  phase: AuctionPhase;
}

export interface BidderAuctionListResponse {
  data: BidderAuction[];
  pagination: PaginationMetadata;
  serverTime: string;
}

export interface BidderAuctionDetailResponse {
  auction: BidderAuction;
  serverTime: string;
}

export interface CurrentCommitment {
  id: string;
  protocolVersion: number;
  committedAt: string;
}

export interface BidParticipation {
  bidId: string;
  status: BidStatus;
  version: number;
  currentCommitment: CurrentCommitment;
  invalidReason: BidInvalidReason | null;
}

export interface BidParticipationResponse {
  auctionId: string;
  phase: AuctionPhase;
  canCommit: boolean;
  participation: BidParticipation | null;
  serverTime: string;
}

export interface BidCommitmentResponse {
  auctionId: string;
  phase: AuctionPhase;
  bid: {
    id: string;
    status: BidStatus;
    version: number;
  };
  commitment: CurrentCommitment;
  replacedPreviousCommitment: boolean;
  serverTime: string;
}

export interface BidRevealStatusResponse {
  auctionId: string;
  phase: AuctionPhase;
  canReveal: boolean;
  bid: {
    id: string;
    status: BidStatus;
    version: number;
  } | null;
  validReveal: {
    id: string;
    amountCents: string;
    submittedAt: string;
  } | null;
  invalidAttemptCount: number;
  serverTime: string;
}

export interface BidRevealResponse {
  auctionId: string;
  phase: AuctionPhase;
  bid: {
    id: string;
    status: BidStatus;
    version: number;
  };
  reveal: {
    id: string;
    validationStatus: RevealValidationStatus;
    amountCents: string;
    submittedAt: string;
  };
  serverTime: string;
}

export interface BidderAuctionResultResponse {
  auction: BidderAuction & {
    status: "SETTLED";
    phase: "SETTLED";
    settledAt: string;
  };
  result: {
    winner: {
      amountCents: string;
    } | null;
    totalBidCount: number;
    validRevealCount: number;
    invalidBidCount: number;
    yourOutcome: {
      status: BidderAuctionOutcome;
      amountCents: string | null;
      invalidReason: BidInvalidReason | null;
    };
  };
  serverTime: string;
}

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

export interface SubmitCommitmentRequest {
  clientRequestId: string;
  commitmentHash: string;
  protocolVersion: 1;
  expectedBidVersion?: number;
}

export interface SubmitRevealRequest {
  clientRequestId: string;
  amountCents: string;
  secret: string;
  expectedBidVersion: number;
}
