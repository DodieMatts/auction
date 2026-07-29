import type { AdminAuction } from "@/lib/admin/admin-auction-types";
import { AuctionStatusBadge } from "@/components/admin/auction-status-badge";
import { LocalDateTime } from "@/components/ui/local-date-time";

import styles from "./auction-metadata.module.css";

interface AuctionMetadataProps {
  auction: AdminAuction;
}

export function AuctionMetadata({ auction }: AuctionMetadataProps) {
  return (
    <dl className={styles.metadata}>
      <div>
        <dt>Status</dt>
        <dd>
          <AuctionStatusBadge value={auction.status} kind="status" />
        </dd>
      </div>
      <div>
        <dt>Phase</dt>
        <dd>
          <AuctionStatusBadge value={auction.phase} kind="phase" />
        </dd>
      </div>
      <div>
        <dt>Currency</dt>
        <dd>{auction.currency}</dd>
      </div>
      <div>
        <dt>Start</dt>
        <dd><LocalDateTime value={auction.startTime} /></dd>
      </div>
      <div>
        <dt>Reveal</dt>
        <dd><LocalDateTime value={auction.revealTime} /></dd>
      </div>
      <div>
        <dt>End</dt>
        <dd><LocalDateTime value={auction.endTime} /></dd>
      </div>
      <div>
        <dt>Version</dt>
        <dd>{auction.version}</dd>
      </div>
      <div>
        <dt>Settled</dt>
        <dd><LocalDateTime value={auction.settledAt} fallback="Not settled" /></dd>
      </div>
      <div>
        <dt>Cancelled</dt>
        <dd><LocalDateTime value={auction.cancelledAt} fallback="Not cancelled" /></dd>
      </div>
      <div className={styles.wide}>
        <dt>Cancellation reason</dt>
        <dd>{auction.cancellationReason ?? "None"}</dd>
      </div>
    </dl>
  );
}
