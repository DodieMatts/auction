import { formatAuctionDateTime } from "@/lib/bidder/bidder-auction-formatters";
import type { BidderAuction } from "@/lib/bidder/bidder-auction-types";

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
        <dd>{formatAuctionDateTime(auction.startTime)}</dd>
      </div>
      <div>
        <dt>Reveal time</dt>
        <dd>{formatAuctionDateTime(auction.revealTime)}</dd>
      </div>
      <div>
        <dt>End time</dt>
        <dd>{formatAuctionDateTime(auction.endTime)}</dd>
      </div>
    </dl>
  );
}
