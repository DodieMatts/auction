import { deriveAuctionPhase } from "../auctions/auction-domain.utils";
import type { AuctionPhase } from "../auctions/types/auction-phase.enum";
import type { AuctionStatus, BidStatus } from "../generated/prisma/enums";
import type { BidCommitmentResponse } from "./types/bid-commitment-response.type";
import type { BidParticipationResponse } from "./types/bid-participation-response.type";

export type CommitmentAuctionRecord = {
  id: string;
  status: AuctionStatus;
  startTime: Date;
  revealTime: Date;
  endTime: Date;
};

export type CommitmentBidRecord = {
  id: string;
  status: BidStatus;
  version: number;
};

export type CurrentCommitmentRecord = {
  id: string;
  commitmentHash: string;
  protocolVersion: number;
  committedAt: Date;
};

export function deriveCommitmentPhase(
  auction: CommitmentAuctionRecord,
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

export function mapBidCommitmentResponse(input: {
  auction: CommitmentAuctionRecord;
  bid: CommitmentBidRecord;
  commitment: CurrentCommitmentRecord;
  replacedPreviousCommitment: boolean;
  databaseNow: Date;
}): BidCommitmentResponse {
  return {
    auctionId: input.auction.id,
    phase: deriveCommitmentPhase(input.auction, input.databaseNow),
    bid: {
      id: input.bid.id,
      status: input.bid.status,
      version: input.bid.version,
    },
    commitment: {
      id: input.commitment.id,
      commitmentHash: input.commitment.commitmentHash,
      protocolVersion: input.commitment.protocolVersion,
      committedAt: input.commitment.committedAt.toISOString(),
    },
    replacedPreviousCommitment: input.replacedPreviousCommitment,
    serverTime: input.databaseNow.toISOString(),
  };
}

export function mapBidParticipationResponse(input: {
  auction: CommitmentAuctionRecord;
  bid:
    | (CommitmentBidRecord & {
        currentCommitment: CurrentCommitmentRecord | null;
      })
    | null;
  databaseNow: Date;
}): BidParticipationResponse {
  const phase = deriveCommitmentPhase(input.auction, input.databaseNow);

  return {
    auctionId: input.auction.id,
    phase,
    canCommit: phase === "COMMIT",
    participation:
      input.bid && input.bid.currentCommitment
        ? {
            bidId: input.bid.id,
            status: input.bid.status,
            version: input.bid.version,
            currentCommitment: {
              id: input.bid.currentCommitment.id,
              commitmentHash: input.bid.currentCommitment.commitmentHash,
              protocolVersion: input.bid.currentCommitment.protocolVersion,
              committedAt: input.bid.currentCommitment.committedAt.toISOString(),
            },
          }
        : null,
    serverTime: input.databaseNow.toISOString(),
  };
}
