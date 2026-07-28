import type { AdminAuctionResultResponse } from "@/lib/admin/admin-auction-types";
import { formatAuctionDateTime, formatAuctionMoney } from "@/lib/admin/admin-auction-formatters";

import styles from "./auction-result-summary.module.css";

interface AuctionResultSummaryProps {
  result: AdminAuctionResultResponse;
}

export function AuctionResultSummary({ result }: AuctionResultSummaryProps) {
  const { summary, auction } = result;

  return (
    <section className={styles.panel} aria-labelledby="auction-results-title">
      <div>
        <h2 id="auction-results-title">Settlement results</h2>
        <p>Administrator-safe settlement summary. Losing amounts remain private.</p>
      </div>

      <div className={styles.grid}>
        <SummaryItem label="Total bids" value={String(summary.totalBidCount)} />
        <SummaryItem label="Valid reveals" value={String(summary.validRevealCount)} />
        <SummaryItem label="Invalid bids" value={String(summary.invalidBidCount)} />
        <SummaryItem label="Settled" value={formatAuctionDateTime(auction.settledAt)} />
      </div>

      <div className={styles.winner}>
        <span className={styles.symbol} aria-hidden="true">
          ✓
        </span>
        <div>
          <h3>{summary.winner ? "Winner" : "No winner"}</h3>
          {summary.winner ? (
            <p>
              {summary.winner.bidder.email} won at{" "}
              {formatAuctionMoney(summary.winner.amountCents, auction.currency)}.
            </p>
          ) : (
            <p>No valid revealed bid was available for this auction.</p>
          )}
        </div>
      </div>
    </section>
  );
}

function SummaryItem({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.item}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
