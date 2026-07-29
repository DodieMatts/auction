import type { AuctionStatus, BidStatus } from "../../generated/prisma/enums";

export type SettledAuctionData = {
  auction: {
    id: string;
    title: string;
    description: string | null;
    currency: string;
    startTime: Date;
    revealTime: Date;
    endTime: Date;
    status: AuctionStatus;
    settledAt: Date | null;
    version: number;
  };
  serverTime: Date;
  totalBidCount: number;
  validRevealCount: number;
  invalidBidCount: number;
  invalidReasons: Array<{
    reason: string;
    count: number;
  }>;
  winner: {
    bidId: string;
    bidderId: string;
    bidderEmail: string;
    amountCents: bigint;
  } | null;
  requestingBidderParticipation: {
    bidId: string;
    status: BidStatus;
    amountCents: bigint | null;
    invalidReason: string | null;
  } | null;
};
