import { StatusBadge } from "@/components/ui/status-badge";
import {
  formatAuctionPhase,
  formatAuctionStatus,
  getAuctionStatusTone,
} from "@/lib/admin/admin-auction-formatters";
import type { AuctionPhase, AuctionStatus } from "@/lib/admin/admin-auction-types";

export function AuctionStatusBadge({
  value,
  kind,
}: {
  value: AuctionStatus | AuctionPhase;
  kind: "status" | "phase";
}) {
  const label = kind === "status" ? formatAuctionStatus(value as AuctionStatus) : formatAuctionPhase(value as AuctionPhase);
  return (
    <StatusBadge tone={getAuctionStatusTone(value)}>
      {`${symbolFor(value)} ${label}`}
    </StatusBadge>
  );
}

function symbolFor(value: AuctionStatus | AuctionPhase): string {
  switch (value) {
    case "PUBLISHED":
    case "COMMIT":
    case "SETTLED":
      return "✓";
    case "SCHEDULED":
    case "REVEAL":
    case "ENDED":
      return "!";
    case "CANCELLED":
      return "×";
    case "DRAFT":
    default:
      return "○";
  }
}
