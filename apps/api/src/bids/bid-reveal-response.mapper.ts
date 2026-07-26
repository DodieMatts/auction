import { deriveAuctionPhase } from "../auctions/auction-domain.utils";
import { AuctionPhase } from "../auctions/types/auction-phase.enum";
import type {
  AuctionStatus,
  BidStatus,
  RevealValidationStatus,
} from "../generated/prisma/enums";
import type {
  BidRevealResponse,
  InvalidBidRevealDetails,
} from "./types/bid-reveal-response.type";
import type { BidRevealStatusResponse } from "./types/bid-reveal-status-response.type";

export type RevealAuctionRecord = {
  id: string;
  status: AuctionStatus;
  startTime: Date;
  revealTime: Date;
  endTime: Date;
};

export type RevealBidRecord = {
  id: string;
  status: BidStatus;
  version: number;
};

export type RevealAttemptRecord = {
  id: string;
  amountCents: bigint;
  validationStatus: RevealValidationStatus;
  invalidReason: string | null;
  submittedAt: Date;
};

export function deriveRevealPhase(
  auction: RevealAuctionRecord,
  databaseNow: Date,
): AuctionPhase {
  return deriveAuctionPhase({
    status: auction.status,
    startTime: auction.startTime,
    revealTime: auction.revealTime,
    endTime: auction.endTime,
    databaseNow,
  });
}

export function mapValidBidRevealResponse(input: {
  auction: RevealAuctionRecord;
  bid: RevealBidRecord;
  reveal: RevealAttemptRecord;
  databaseNow: Date;
}): BidRevealResponse {
  return {
    auctionId: input.auction.id,
    phase: deriveRevealPhase(input.auction, input.databaseNow),
    bid: {
      id: input.bid.id,
      status: input.bid.status,
      version: input.bid.version,
    },
    reveal: {
      id: input.reveal.id,
      validationStatus: input.reveal.validationStatus,
      amountCents: input.reveal.amountCents.toString(),
      submittedAt: input.reveal.submittedAt.toISOString(),
    },
    serverTime: input.databaseNow.toISOString(),
  };
}

export function mapInvalidBidRevealDetails(input: {
  auction: RevealAuctionRecord;
  reveal: RevealAttemptRecord;
  databaseNow: Date;
}): InvalidBidRevealDetails {
  return {
    auctionId: input.auction.id,
    revealAttemptId: input.reveal.id,
    validationStatus: input.reveal.validationStatus,
    invalidReason: input.reveal.invalidReason ?? "COMMITMENT_MISMATCH",
    submittedAt: input.reveal.submittedAt.toISOString(),
    serverTime: input.databaseNow.toISOString(),
  };
}

export function mapBidRevealStatusResponse(input: {
  auction: RevealAuctionRecord;
  bid:
    | (RevealBidRecord & {
        currentCommitment: { id: string } | null;
      })
    | null;
  validReveal: Pick<RevealAttemptRecord, "id" | "amountCents" | "submittedAt"> | null;
  invalidAttemptCount: number;
  databaseNow: Date;
}): BidRevealStatusResponse {
  const phase = deriveRevealPhase(input.auction, input.databaseNow);

  return {
    auctionId: input.auction.id,
    phase,
    canReveal:
      phase === AuctionPhase.REVEAL &&
      input.bid?.status === "COMMITTED" &&
      input.bid.currentCommitment !== null &&
      input.validReveal === null,
    bid: input.bid
      ? {
          id: input.bid.id,
          status: input.bid.status,
          version: input.bid.version,
        }
      : null,
    validReveal: input.validReveal
      ? {
          id: input.validReveal.id,
          amountCents: input.validReveal.amountCents.toString(),
          submittedAt: input.validReveal.submittedAt.toISOString(),
        }
      : null,
    invalidAttemptCount: input.invalidAttemptCount,
    serverTime: input.databaseNow.toISOString(),
  };
}
