import type { AuctionResponse } from "./auction-response.type";

export type AuctionListResponse = {
  data: AuctionResponse[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
  serverTime: string;
};
