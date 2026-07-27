import { StatusBadge } from "@/components/ui/status-badge";
import {
  formatAuctionPhase,
  getOutcomeTone,
  getPhaseTone,
  type StatusTone,
} from "@/lib/bidder/bidder-auction-formatters";
import type {
  AuctionPhase,
  AuctionStatus,
  BidderAuctionOutcome,
} from "@/lib/bidder/bidder-auction-types";

export function BidderAuctionStatus({
  phase,
  status,
}: {
  phase: AuctionPhase;
  status?: AuctionStatus;
}) {
  const label = status === "SETTLED" ? "Settled" : formatAuctionPhase(phase);
  return <StatusBadge tone={getPhaseTone(phase)}>{label}</StatusBadge>;
}

export function BidderOutcomeStatus({ outcome }: { outcome: BidderAuctionOutcome }) {
  return <StatusBadge tone={getOutcomeTone(outcome)}>{formatOutcomeLabel(outcome)}</StatusBadge>;
}

export function BidStatusPill({
  tone,
  label,
}: {
  tone: StatusTone;
  label: string;
}) {
  return <StatusBadge tone={tone}>{label}</StatusBadge>;
}

function formatOutcomeLabel(outcome: BidderAuctionOutcome): string {
  if (outcome === "NOT_PARTICIPATED") return "Not participated";
  return outcome.charAt(0) + outcome.slice(1).toLowerCase();
}
