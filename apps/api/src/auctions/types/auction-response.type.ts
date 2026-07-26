import type { AuctionStatus } from "../../generated/prisma/enums";
import type { AuctionPhase } from "./auction-phase.enum";

export type AuctionResponse = {
  id: string;
  title: string;
  description: string | null;
  currency: string;
  startTime: string;
  revealTime: string;
  endTime: string;
  status: AuctionStatus;
  phase: AuctionPhase;
  createdById: string;
  version: number;
  settledAt: string | null;
  cancelledAt: string | null;
  cancellationReason: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SingleAuctionResponse = {
  auction: AuctionResponse;
  serverTime: string;
};
