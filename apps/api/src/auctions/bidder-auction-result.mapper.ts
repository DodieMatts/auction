import { deriveAuctionPhase } from "./auction-domain.utils";
import { deriveBidderAuctionOutcome } from "./auction-results-domain.utils";
import type { BidderAuctionResultResponse } from "./types/bidder-auction-result-response.type";
import type { SettledAuctionData } from "./types/settled-auction-data.type";

export function mapBidderAuctionResult(
  data: SettledAuctionData,
): BidderAuctionResultResponse {
  if (!data.auction.settledAt) {
    throw new Error("Bidder auction result requires settledAt");
  }

  return {
    auction: {
      id: data.auction.id,
      title: data.auction.title,
      description: data.auction.description,
      currency: data.auction.currency,
      startTime: data.auction.startTime.toISOString(),
      revealTime: data.auction.revealTime.toISOString(),
      endTime: data.auction.endTime.toISOString(),
      status: data.auction.status,
      phase: deriveAuctionPhase({
        status: data.auction.status,
        startTime: data.auction.startTime,
        revealTime: data.auction.revealTime,
        endTime: data.auction.endTime,
        databaseNow: data.serverTime,
      }),
      settledAt: data.auction.settledAt.toISOString(),
    },
    result: {
      winner: data.winner
        ? {
            amountCents: data.winner.amountCents.toString(),
          }
        : null,
      totalBidCount: data.totalBidCount,
      validRevealCount: data.validRevealCount,
      invalidBidCount: data.invalidBidCount,
      yourOutcome: deriveBidderAuctionOutcome(data.requestingBidderParticipation),
    },
    serverTime: data.serverTime.toISOString(),
  };
}
