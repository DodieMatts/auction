import type { BidderAuction } from "@/lib/bidder/bidder-auction-types";

import { BidderAuctionCard } from "./bidder-auction-card";
import styles from "./bidder-auction-list.module.css";

export function BidderAuctionList({ auctions }: { auctions: BidderAuction[] }) {
  if (auctions.length === 0) {
    return <p className={styles.empty}>No available auctions match this page.</p>;
  }

  return (
    <div className={styles.grid}>
      {auctions.map((auction) => (
        <BidderAuctionCard key={auction.id} auction={auction} />
      ))}
    </div>
  );
}
