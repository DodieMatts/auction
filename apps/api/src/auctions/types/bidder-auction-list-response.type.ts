import type { BidderAuctionResponse } from "./bidder-auction-response.type";

export type BidderAuctionListResponse = {
  data: BidderAuctionResponse[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
  serverTime: string;
};
