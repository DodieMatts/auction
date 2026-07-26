import type { AuctionPhase } from "./auction-phase.enum";
import type { AuctionStatus } from "../../generated/prisma/enums";
import type { SettlementSummary } from "./settlement-summary.type";

export type AuctionSettlementResponse = {
  auction: {
    id: string;
    status: AuctionStatus;
    phase: AuctionPhase;
    version: number;
    settledAt: string;
  };
  summary: SettlementSummary;
  serverTime: string;
};
