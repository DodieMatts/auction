import type { BidStatus } from "../../generated/prisma/enums";
import type { AuctionPhase } from "../../auctions/types/auction-phase.enum";

export type BidCommitmentResponse = {
  auctionId: string;
  phase: AuctionPhase;
  bid: {
    id: string;
    status: BidStatus;
    version: number;
  };
  commitment: {
    id: string;
    commitmentHash: string;
    protocolVersion: number;
    committedAt: string;
  };
  replacedPreviousCommitment: boolean;
  serverTime: string;
};
