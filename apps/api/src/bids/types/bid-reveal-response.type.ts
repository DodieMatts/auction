import type { AuctionPhase } from "../../auctions/types/auction-phase.enum";
import type { BidStatus, RevealValidationStatus } from "../../generated/prisma/enums";

export type BidRevealResponse = {
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
};

export type InvalidBidRevealDetails = {
  auctionId: string;
  revealAttemptId: string;
  validationStatus: RevealValidationStatus;
  invalidReason: string;
  submittedAt: string;
  serverTime: string;
};
