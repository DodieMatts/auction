import type { AuctionPhase } from "./auction-phase.enum";
import type { BidderAuctionOutcome } from "./bidder-auction-outcome.enum";
import type { AuctionStatus } from "../../generated/prisma/enums";

export type BidderAuctionResultResponse = {
  auction: {
    id: string;
    title: string;
    description: string | null;
    currency: string;
    startTime: string;
    revealTime: string;
    endTime: string;
    status: AuctionStatus;
    phase: AuctionPhase;
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
      invalidReason: string | null;
    };
  };
  serverTime: string;
};
