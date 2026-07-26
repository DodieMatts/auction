import { deriveAuctionPhase } from "./auction-domain.utils";
import type { AdminAuctionResultResponse } from "./types/admin-auction-result-response.type";
import type { SettledAuctionData } from "./types/settled-auction-data.type";

export function mapAdminAuctionResult(
  data: SettledAuctionData,
): AdminAuctionResultResponse {
  if (!data.auction.settledAt) {
    throw new Error("Admin auction result requires settledAt");
  }

  return {
    auction: {
      id: data.auction.id,
      title: data.auction.title,
      currency: data.auction.currency,
      status: data.auction.status,
      phase: deriveAuctionPhase({
        status: data.auction.status,
        startTime: data.auction.startTime,
        revealTime: data.auction.revealTime,
        endTime: data.auction.endTime,
        databaseNow: data.serverTime,
      }),
      settledAt: data.auction.settledAt.toISOString(),
      version: data.auction.version,
    },
    summary: {
      totalBidCount: data.totalBidCount,
      validRevealCount: data.validRevealCount,
      invalidBidCount: data.invalidBidCount,
      winner: data.winner
        ? {
            bidder: {
              id: data.winner.bidderId,
              email: data.winner.bidderEmail,
            },
            amountCents: data.winner.amountCents.toString(),
          }
        : null,
    },
    serverTime: data.serverTime.toISOString(),
  };
}
