import { InternalServerErrorException } from "@nestjs/common";

import { BidStatus, RevealValidationStatus } from "../generated/prisma/enums";
import type { SettlementCandidate } from "./types/settlement-candidate.type";

type SettlementBidInvariantRecord = {
  status: BidStatus;
  commitments: Array<{
    isCurrent: boolean;
  }>;
  revealAttempts: Array<{
    validationStatus: RevealValidationStatus;
  }>;
};

const inconsistentAuctionMessage = "Auction data is inconsistent";

export function validateSettlementBidInvariants(
  bids: SettlementBidInvariantRecord[],
): void {
  for (const bid of bids) {
    const currentCommitmentCount = bid.commitments.filter(
      (commitment) => commitment.isCurrent,
    ).length;
    const validRevealCount = bid.revealAttempts.filter(
      (attempt) => attempt.validationStatus === RevealValidationStatus.VALID,
    ).length;

    if (currentCommitmentCount !== 1 || validRevealCount > 1) {
      throw new InternalServerErrorException(inconsistentAuctionMessage);
    }

    if (
      bid.status === BidStatus.WON ||
      bid.status === BidStatus.LOST ||
      (bid.status === BidStatus.REVEALED && validRevealCount !== 1) ||
      (bid.status === BidStatus.COMMITTED && validRevealCount !== 0) ||
      (bid.status === BidStatus.INVALID && validRevealCount !== 0)
    ) {
      throw new InternalServerErrorException(inconsistentAuctionMessage);
    }
  }
}

export function selectSettlementWinner(
  candidates: SettlementCandidate[],
): SettlementCandidate | null {
  let winner: SettlementCandidate | null = null;

  for (const candidate of candidates) {
    if (!winner) {
      winner = candidate;
      continue;
    }

    if (candidate.amountCents > winner.amountCents) {
      winner = candidate;
      continue;
    }

    if (candidate.amountCents < winner.amountCents) {
      continue;
    }

    if (
      candidate.commitmentCommittedAt.getTime() <
      winner.commitmentCommittedAt.getTime()
    ) {
      winner = candidate;
      continue;
    }

    if (
      candidate.commitmentCommittedAt.getTime() >
      winner.commitmentCommittedAt.getTime()
    ) {
      continue;
    }

    if (candidate.bidId < winner.bidId) {
      winner = candidate;
    }
  }

  return winner;
}
