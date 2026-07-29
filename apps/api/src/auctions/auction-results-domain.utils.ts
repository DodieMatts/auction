import { InternalServerErrorException } from "@nestjs/common";

import {
  AuctionStatus,
  BidStatus,
  RevealValidationStatus,
} from "../generated/prisma/enums";
import { BidderAuctionOutcome } from "./types/bidder-auction-outcome.enum";

type SettledBidInvariantRecord = {
  status: BidStatus;
  commitments: Array<{
    isCurrent: boolean;
  }>;
  revealAttempts: Array<{
    validationStatus: RevealValidationStatus;
  }>;
};

type SettledAuctionInvariantRecord = {
  status: AuctionStatus;
  settledAt: Date | null;
};

type BidderOutcomeInput = {
  status: BidStatus;
  amountCents: bigint | null;
  invalidReason: string | null;
} | null;

const inconsistentResultsMessage = "Auction result data is inconsistent";

export function validateSettledAuctionInvariants(input: {
  auction: SettledAuctionInvariantRecord;
  bids: SettledBidInvariantRecord[];
}): void {
  if (
    input.auction.status !== AuctionStatus.SETTLED ||
    input.auction.settledAt === null
  ) {
    throw new InternalServerErrorException(inconsistentResultsMessage);
  }

  let winnerCount = 0;

  for (const bid of input.bids) {
    const currentCommitmentCount = bid.commitments.filter(
      (commitment) => commitment.isCurrent,
    ).length;
    const validRevealCount = bid.revealAttempts.filter(
      (attempt) => attempt.validationStatus === RevealValidationStatus.VALID,
    ).length;

    if (currentCommitmentCount !== 1 || validRevealCount > 1) {
      throw new InternalServerErrorException(inconsistentResultsMessage);
    }

    if (bid.status === BidStatus.COMMITTED || bid.status === BidStatus.REVEALED) {
      throw new InternalServerErrorException(inconsistentResultsMessage);
    }

    if (bid.status === BidStatus.WON) {
      winnerCount += 1;
    }

    if (
      (bid.status === BidStatus.WON || bid.status === BidStatus.LOST) &&
      validRevealCount !== 1
    ) {
      throw new InternalServerErrorException(inconsistentResultsMessage);
    }

    if (bid.status === BidStatus.INVALID && validRevealCount !== 0) {
      throw new InternalServerErrorException(inconsistentResultsMessage);
    }
  }

  if (winnerCount > 1) {
    throw new InternalServerErrorException(inconsistentResultsMessage);
  }
}

export function deriveBidderAuctionOutcome(input: BidderOutcomeInput): {
  status: BidderAuctionOutcome;
  amountCents: string | null;
  invalidReason: string | null;
} {
  if (!input) {
    return {
      status: BidderAuctionOutcome.NOT_PARTICIPATED,
      amountCents: null,
      invalidReason: null,
    };
  }

  if (input.status === BidStatus.WON || input.status === BidStatus.LOST) {
    if (input.amountCents === null) {
      throw new InternalServerErrorException(inconsistentResultsMessage);
    }

    return {
      status:
        input.status === BidStatus.WON
          ? BidderAuctionOutcome.WON
          : BidderAuctionOutcome.LOST,
      amountCents: input.amountCents.toString(),
      invalidReason: null,
    };
  }

  if (input.status === BidStatus.INVALID) {
    return {
      status: BidderAuctionOutcome.INVALID,
      amountCents: null,
      invalidReason: input.invalidReason ?? "NOT_REVEALED",
    };
  }

  throw new InternalServerErrorException(inconsistentResultsMessage);
}
