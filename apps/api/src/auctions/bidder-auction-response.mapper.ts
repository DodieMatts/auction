import type { AuctionStatus } from "../generated/prisma/enums";
import { deriveAuctionPhase } from "./auction-domain.utils";
import type { BidderAuctionResponse } from "./types/bidder-auction-response.type";

export type BidderAuctionRecord = {
  id: string;
  title: string;
  description: string | null;
  currency: string;
  startTime: Date;
  revealTime: Date;
  endTime: Date;
  status: AuctionStatus;
};

export function mapBidderAuctionResponse(
  auction: BidderAuctionRecord,
  databaseNow: Date,
): BidderAuctionResponse {
  return {
    id: auction.id,
    title: auction.title,
    description: auction.description,
    currency: auction.currency,
    startTime: auction.startTime.toISOString(),
    revealTime: auction.revealTime.toISOString(),
    endTime: auction.endTime.toISOString(),
    status: auction.status,
    phase: deriveAuctionPhase({
      status: auction.status,
      startTime: auction.startTime,
      revealTime: auction.revealTime,
      endTime: auction.endTime,
      databaseNow,
    }),
  };
}
