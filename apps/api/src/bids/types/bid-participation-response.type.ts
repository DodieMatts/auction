import type { BidStatus } from "../../generated/prisma/enums";
import type { AuctionPhase } from "../../auctions/types/auction-phase.enum";

export type BidParticipationResponse = {
  auctionId: string;
  phase: AuctionPhase;
  canCommit: boolean;
  participation: {
    bidId: string;
    status: BidStatus;
    version: number;
    currentCommitment: {
      id: string;
      commitmentHash: string;
      protocolVersion: number;
      committedAt: string;
    };
  } | null;
  serverTime: string;
};
