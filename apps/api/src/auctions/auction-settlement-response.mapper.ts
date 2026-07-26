import { deriveAuctionPhase } from "./auction-domain.utils";
import type { AuctionSettlementResponse } from "./types/auction-settlement-response.type";
import type { SettlementSummary } from "./types/settlement-summary.type";
import type { AuctionStatus } from "../generated/prisma/enums";

export type SettledAuctionRecord = {
  id: string;
  status: AuctionStatus;
  startTime: Date;
  revealTime: Date;
  endTime: Date;
  version: number;
  settledAt: Date | null;
};

export function mapAuctionSettlementResponse(input: {
  auction: SettledAuctionRecord;
  summary: SettlementSummary;
  databaseNow: Date;
}): AuctionSettlementResponse {
  if (!input.auction.settledAt) {
    throw new Error("Settled auction response requires settledAt");
  }

  return {
    auction: {
      id: input.auction.id,
      status: input.auction.status,
      phase: deriveAuctionPhase({
        status: input.auction.status,
        startTime: input.auction.startTime,
        revealTime: input.auction.revealTime,
        endTime: input.auction.endTime,
        databaseNow: input.databaseNow,
      }),
      version: input.auction.version,
      settledAt: input.auction.settledAt.toISOString(),
    },
    summary: input.summary,
    serverTime: input.databaseNow.toISOString(),
  };
}
