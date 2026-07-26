import type { AuctionPhase } from "../../auctions/types/auction-phase.enum";
import type { BidStatus } from "../../generated/prisma/enums";

export type BidRevealStatusResponse = {
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
};
