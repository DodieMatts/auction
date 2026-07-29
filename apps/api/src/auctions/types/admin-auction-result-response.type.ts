import type { AuctionPhase } from "./auction-phase.enum";
import type { AuctionStatus } from "../../generated/prisma/enums";

export type AdminAuctionResultResponse = {
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
    invalidReasons: Array<{
      reason: string;
      count: number;
    }>;
    winner: {
      bidder: {
        id: string;
        email: string;
      };
      amountCents: string;
    } | null;
  };
  serverTime: string;
};
