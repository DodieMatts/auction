import {
  formatAuctionDateTime,
  formatAuctionMoney,
  formatOutcome,
} from "@/lib/bidder/bidder-auction-formatters";
import type { BidderAuctionResultResponse } from "@/lib/bidder/bidder-auction-types";

import { BidderOutcomeStatus } from "./bidder-auction-status";
import styles from "./bidder-result-summary.module.css";

export function BidderResultSummary({ result }: { result: BidderAuctionResultResponse }) {
  const yourOutcome = result.result.yourOutcome;

  return (
    <section className={styles.summary} aria-labelledby="result-title">
      <div className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Settlement result</p>
          <h2 id="result-title">Final outcome</h2>
        </div>
        <BidderOutcomeStatus outcome={yourOutcome.status} />
      </div>

      <dl className={styles.grid}>
        <div>
          <dt>Winning amount</dt>
          <dd>
            {result.result.winner
              ? formatAuctionMoney(result.result.winner.amountCents, result.auction.currency)
              : "No winning bid"}
          </dd>
        </div>
        <div>
          <dt>Your outcome</dt>
          <dd>{formatOutcome(yourOutcome.status)}</dd>
        </div>
        <div>
          <dt>Your amount</dt>
          <dd>
            {yourOutcome.amountCents
              ? formatAuctionMoney(yourOutcome.amountCents, result.auction.currency)
              : "Not available"}
          </dd>
        </div>
        <div>
          <dt>Total bids</dt>
          <dd>{result.result.totalBidCount}</dd>
        </div>
        <div>
          <dt>Valid reveals</dt>
          <dd>{result.result.validRevealCount}</dd>
        </div>
        <div>
          <dt>Invalid bids</dt>
          <dd>{result.result.invalidBidCount}</dd>
        </div>
        <div>
          <dt>Settlement time</dt>
          <dd>{formatAuctionDateTime(result.auction.settledAt)}</dd>
        </div>
      </dl>
    </section>
  );
}
