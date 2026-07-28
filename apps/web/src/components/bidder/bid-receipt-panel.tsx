"use client";

import { useState } from "react";

import {
  copyRevealReceipt,
  downloadRevealReceipt,
  serializeRevealReceipt,
} from "@/lib/bidder/bid-receipt";
import { formatAuctionDateTime } from "@/lib/bidder/bidder-auction-formatters";
import type { RevealReceipt } from "@/lib/bidder/bidder-auction-types";

import styles from "./bid-receipt-panel.module.css";

export function BidReceiptPanel({ receipt }: { receipt: RevealReceipt }) {
  const [isOpen, setIsOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function handleCopy() {
    try {
      await copyRevealReceipt(receipt);
      setMessage("Receipt copied. Store it somewhere secure.");
    } catch {
      setMessage("Receipt could not be copied. Use the download action instead.");
    }
  }

  return (
    <section className={styles.panel} aria-labelledby="receipt-title">
      <div>
        <p className={styles.eyebrow}>Commitment submitted</p>
        <h2 id="receipt-title">Save this receipt now.</h2>
        <p>The bid cannot be revealed without it. Replacements require a new receipt.</p>
      </div>

      <dl className={styles.details}>
        <div>
          <dt>Committed at</dt>
          <dd>{formatAuctionDateTime(receipt.committedAt)}</dd>
        </div>
        <div>
          <dt>Bid version</dt>
          <dd>{receipt.bidVersion}</dd>
        </div>
      </dl>

      <div className={styles.actions}>
        <button type="button" onClick={() => downloadRevealReceipt(receipt)}>
          Download receipt
        </button>
        <button type="button" onClick={handleCopy}>
          Copy receipt
        </button>
        <button type="button" onClick={() => setIsOpen((value) => !value)}>
          {isOpen ? "Hide sensitive receipt" : "Show sensitive receipt"}
        </button>
      </div>

      {message ? (
        <p className={styles.message} aria-live="polite">
          {message}
        </p>
      ) : null}

      {isOpen ? (
        <label className={styles.receipt}>
          <span>Sensitive receipt payload</span>
          <textarea readOnly rows={12} value={serializeRevealReceipt(receipt)} />
        </label>
      ) : null}
    </section>
  );
}
