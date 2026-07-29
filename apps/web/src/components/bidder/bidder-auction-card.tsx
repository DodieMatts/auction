import Link from "next/link";

import type { BidderAuction } from "@/lib/bidder/bidder-auction-types";
import { LocalDateTime } from "@/components/ui/local-date-time";

import { BidderAuctionStatus } from "./bidder-auction-status";
import styles from "./bidder-auction-card.module.css";

export function BidderAuctionCard({ auction }: { auction: BidderAuction }) {
  return (
    <article className={styles.card}>
      <div className={styles.header}>
        <div>
          <h2>{auction.title}</h2>
          <p>{auction.description || "No description provided."}</p>
        </div>
        <BidderAuctionStatus phase={auction.phase} status={auction.status} />
      </div>

      <dl className={styles.metadata}>
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
      </dl>

      <Link className={styles.action} href={`/auctions/${auction.id}`}>
        View auction
      </Link>
    </article>
  );
}
