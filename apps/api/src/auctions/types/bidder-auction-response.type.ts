import type { AuctionStatus } from "../../generated/prisma/enums";
import type { AuctionPhase } from "./auction-phase.enum";

export type BidderAuctionResponse = {
  id: string;
  title: string;
  description: string | null;
  currency: string;
  startTime: string;
  revealTime: string;
  endTime: string;
  status: AuctionStatus;
  phase: AuctionPhase;
};

export type SingleBidderAuctionResponse = {
  auction: BidderAuctionResponse;
  serverTime: string;
};
