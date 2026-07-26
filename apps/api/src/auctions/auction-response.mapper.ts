import type { AuctionStatus } from "../generated/prisma/enums";
import { deriveAuctionPhase } from "./auction-domain.utils";
import type { AuctionResponse } from "./types/auction-response.type";

export type AuctionRecord = {
  id: string;
  title: string;
  description: string | null;
  currency: string;
  startTime: Date;
  revealTime: Date;
  endTime: Date;
  status: AuctionStatus;
  createdById: string;
  version: number;
  settledAt: Date | null;
  cancelledAt: Date | null;
  cancellationReason: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export function mapAuctionResponse(
  auction: AuctionRecord,
  databaseNow: Date,
): AuctionResponse {
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
    createdById: auction.createdById,
    version: auction.version,
    settledAt: auction.settledAt?.toISOString() ?? null,
    cancelledAt: auction.cancelledAt?.toISOString() ?? null,
    cancellationReason: auction.cancellationReason,
    createdAt: auction.createdAt.toISOString(),
    updatedAt: auction.updatedAt.toISOString(),
  };
}
