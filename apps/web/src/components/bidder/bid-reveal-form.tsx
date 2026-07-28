"use client";

import { useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { submitReveal, BidderAuctionClientError } from "@/lib/bidder/bidder-auction-client";
import {
  parseRevealReceipt,
  validateRevealReceiptForAuction,
} from "@/lib/bidder/bid-receipt";
import type {
  BidRevealStatusResponse,
  BidderAuction,
  RevealReceipt,
} from "@/lib/bidder/bidder-auction-types";
import type { AuthenticatedUser } from "@/lib/auth/auth-types";

import styles from "./bid-reveal-form.module.css";

type SubmissionState =
  | { type: "idle" }
  | { type: "ready"; receipt: RevealReceipt; message: string }
  | { type: "success"; message: string }
  | { type: "error"; message: string; canRefresh?: boolean };

export function BidRevealForm({
  auction,
  user,
  revealStatus,
}: {
  auction: BidderAuction;
  user: AuthenticatedUser;
  revealStatus: BidRevealStatusResponse;
}) {
  const router = useRouter();
  const clientRequestId = useRef(crypto.randomUUID());
  const [receiptText, setReceiptText] = useState("");
  const [state, setState] = useState<SubmissionState>({ type: "idle" });
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setReceiptText(await file.text());
    setState({ type: "idle" });
  }

  async function validateReceipt(): Promise<RevealReceipt | null> {
    try {
      const receipt = parseRevealReceipt(receiptText);
      const validated = await validateRevealReceiptForAuction({
        receipt,
        auction,
        user,
        activeCommitmentHash: null,
      });
      if (revealStatus.bid && validated.bidVersion !== revealStatus.bid.version) {
        throw new Error("Receipt version does not match the active bid.");
      }
      setState({ type: "ready", receipt: validated, message: "Receipt is ready to reveal." });
      return validated;
    } catch {
      setState({ type: "error", message: "The receipt does not match this auction." });
      return null;
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) return;

    const receipt = state.type === "ready" ? state.receipt : await validateReceipt();
    if (!receipt) return;
    if (!revealStatus.bid) {
      setState({ type: "error", message: "No commitment is available for reveal." });
      return;
    }

    setIsSubmitting(true);
    try {
      await submitReveal(auction.id, {
        clientRequestId: clientRequestId.current,
        amountCents: receipt.amountCents,
        secret: receipt.secret,
        expectedBidVersion: revealStatus.bid.version,
      });
      clientRequestId.current = crypto.randomUUID();
      setReceiptText("");
      setState({ type: "success", message: "Bid revealed." });
      router.refresh();
    } catch (error) {
      const terminal = error instanceof BidderAuctionClientError && error.status === 422;
      if (terminal) {
        clientRequestId.current = crypto.randomUUID();
      }
      const canRefresh = error instanceof BidderAuctionClientError && error.status === 409;
      setState({ type: "error", message: getSubmissionMessage(error), canRefresh });
      if (error instanceof BidderAuctionClientError && error.status === 401) {
        router.replace("/login");
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section className={styles.module} aria-labelledby="reveal-title">
      <div>
        <p className={styles.eyebrow}>Bid reveal</p>
        <h2 id="reveal-title">Import reveal receipt</h2>
        <p>Upload or paste the saved receipt. The receipt is checked locally before submission.</p>
      </div>

      <form className={styles.form} onSubmit={handleSubmit}>
        <label className={styles.field}>
          <span>Receipt file</span>
          <input type="file" accept="application/json,.json" onChange={handleFile} />
        </label>

        <label className={styles.field}>
          <span>Receipt JSON</span>
          <textarea
            rows={8}
            value={receiptText}
            onChange={(event) => {
              setReceiptText(event.target.value);
              setState({ type: "idle" });
            }}
          />
        </label>

        <div className={styles.actions}>
          <button type="button" onClick={() => void validateReceipt()}>
            Validate receipt
          </button>
          <button type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Revealing..." : "Reveal bid"}
          </button>
        </div>

        {state.type === "ready" || state.type === "success" ? (
          <p className={styles.success} aria-live="polite">
            {state.message}
          </p>
        ) : null}
        {state.type === "error" ? (
          <div className={styles.error} role="alert">
            <p>{state.message}</p>
            {state.canRefresh ? (
              <button type="button" onClick={() => router.refresh()}>
                Refresh
              </button>
            ) : null}
          </div>
        ) : null}
      </form>
    </section>
  );
}

function getSubmissionMessage(error: unknown): string {
  if (error instanceof BidderAuctionClientError) {
    if (error.status === 422) return "The receipt does not match the active commitment.";
    if (error.status === 409) return "Your bid state changed. Refresh before retrying.";
    if (error.status === 503) return "Auction service is unavailable.";
    return error.message;
  }
  return "The reveal could not be submitted.";
}
