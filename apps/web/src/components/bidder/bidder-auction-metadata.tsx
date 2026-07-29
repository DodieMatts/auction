import type { BidderAuction } from "@/lib/bidder/bidder-auction-types";
import { LocalDateTime } from "@/components/ui/local-date-time";

import { BidderAuctionStatus } from "./bidder-auction-status";
import styles from "./bidder-auction-metadata.module.css";

export function BidderAuctionMetadata({ auction }: { auction: BidderAuction }) {
  return (
    <dl className={styles.metadata}>
      <div>
        <dt>Currency</dt>
        <dd>{auction.currency}</dd>
      </div>
      <div>
        <dt>Status</dt>
        <dd>
          <BidderAuctionStatus phase={auction.phase} status={auction.status} />
        </dd>
      </div>
      <div>
        <dt>Start time</dt>
        <dd><LocalDateTime value={auction.startTime} /></dd>
      </div>
      <div>
        <dt>Reveal time</dt>
        <dd><LocalDateTime value={auction.revealTime} /></dd>
      </div>
      <div>
        <dt>End time</dt>
        <dd><LocalDateTime value={auction.endTime} /></dd>
      </div>
    </dl>
  );
}
