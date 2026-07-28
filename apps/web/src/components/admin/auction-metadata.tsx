import type { AdminAuction } from "@/lib/admin/admin-auction-types";
import { formatAuctionDateTime } from "@/lib/admin/admin-auction-formatters";
import { AuctionStatusBadge } from "@/components/admin/auction-status-badge";

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
        <dd>{formatAuctionDateTime(auction.startTime)}</dd>
      </div>
      <div>
        <dt>Reveal</dt>
        <dd>{formatAuctionDateTime(auction.revealTime)}</dd>
      </div>
      <div>
        <dt>End</dt>
        <dd>{formatAuctionDateTime(auction.endTime)}</dd>
      </div>
      <div>
        <dt>Version</dt>
        <dd>{auction.version}</dd>
      </div>
      <div>
        <dt>Settled</dt>
        <dd>{auction.settledAt ? formatAuctionDateTime(auction.settledAt) : "Not settled"}</dd>
      </div>
      <div>
        <dt>Cancelled</dt>
        <dd>
          {auction.cancelledAt ? formatAuctionDateTime(auction.cancelledAt) : "Not cancelled"}
        </dd>
      </div>
      <div className={styles.wide}>
        <dt>Cancellation reason</dt>
        <dd>{auction.cancellationReason ?? "None"}</dd>
      </div>
    </dl>
  );
}
