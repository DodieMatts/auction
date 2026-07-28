import type { AuctionPhase, BidderAuction } from "./bidder-auction-types";

export function calculateServerOffset(serverTime: string, clientNow = Date.now()): number {
  const serverNow = new Date(serverTime).getTime();
  return Number.isNaN(serverNow) ? 0 : serverNow - clientNow;
}

export function getAdjustedCurrentTime(offsetMs: number): Date {
  return new Date(Date.now() + offsetMs);
}

export function getPhaseTargetTime(auction: BidderAuction): {
  label: string;
  targetTime: string | null;
} {
  switch (auction.phase as AuctionPhase) {
    case "SCHEDULED":
      return { label: "Starts in", targetTime: auction.startTime };
    case "COMMIT":
      return { label: "Commitment closes in", targetTime: auction.revealTime };
    case "REVEAL":
      return { label: "Reveal closes in", targetTime: auction.endTime };
    case "ENDED":
    case "SETTLED":
      return { label: "Auction ended", targetTime: null };
  }
}
