"use client";

import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  COMMITMENT_PROTOCOL_VERSION,
  computeBidCommitmentV1,
  generateBidSecretV1,
} from "@auction/commitment";

import { submitCommitment, BidderAuctionClientError } from "@/lib/bidder/bidder-auction-client";
import { parseDisplayAmountToCents } from "@/lib/bidder/bid-amount";
import { createRevealReceipt } from "@/lib/bidder/bid-receipt";
import type {
  BidCommitmentResponse,
  BidParticipationResponse,
  BidderAuction,
  RevealReceipt,
} from "@/lib/bidder/bidder-auction-types";
import type { AuthenticatedUser } from "@/lib/auth/auth-types";

import { BidReceiptPanel } from "./bid-receipt-panel";
import styles from "./bid-commitment-form.module.css";

const replacementBidMessage =
  "You already submitted a bid for this auction. Submitting a new bid will replace your previous bid. Your previous receipt will no longer work, so make sure you save the new receipt.";

type SubmissionState =
  | { type: "idle" }
  | { type: "success"; message: string; receipt: RevealReceipt }
  | { type: "error"; message: string; canRefresh?: boolean };

export function BidCommitmentForm({
  auction,
  user,
  participation,
}: {
  auction: BidderAuction;
  user: AuthenticatedUser;
  participation: BidParticipationResponse;
}) {
  const router = useRouter();
  const clientRequestId = useRef(crypto.randomUUID());
  const [amount, setAmount] = useState("");
  const [confirmedReplacement, setConfirmedReplacement] = useState(false);
  const [state, setState] = useState<SubmissionState>({ type: "idle" });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const existingBid = participation.participation;
  const isReplacement = Boolean(existingBid);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) return;
    if (isReplacement && !confirmedReplacement) {
      setState({ type: "error", message: "Confirm that you understand the new bid replaces your previous bid and the previous receipt will no longer work." });
      return;
    }

    let amountCents: string;
    try {
      amountCents = parseDisplayAmountToCents(amount);
    } catch (error) {
      setState({ type: "error", message: error instanceof Error ? error.message : "Enter a valid amount." });
      return;
    }

    setIsSubmitting(true);
    setState({ type: "idle" });

    try {
      const secret = await generateBidSecretV1();
      const commitmentHash = await computeBidCommitmentV1({
        auctionId: auction.id,
        bidderId: user.id,
        currency: auction.currency,
        amountCents,
        secret,
      });
      const response = await submitCommitment(auction.id, {
        clientRequestId: clientRequestId.current,
        commitmentHash,
        protocolVersion: COMMITMENT_PROTOCOL_VERSION,
        expectedBidVersion: existingBid ? existingBid.version : undefined,
      });
      const receipt = createRevealReceipt({
        auction,
        user,
        amountCents,
        secret,
        commitmentHash,
        response: response as BidCommitmentResponse,
      });

      clientRequestId.current = crypto.randomUUID();
      setAmount("");
      setConfirmedReplacement(false);
      setState({
        type: "success",
        message: response.replacedPreviousCommitment
          ? "New bid submitted. Save the new receipt; the previous receipt will no longer work."
          : "Commitment submitted.",
        receipt,
      });
      router.refresh();
    } catch (error) {
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
    <section className={styles.module} aria-labelledby="commitment-title">
      <div>
        <p className={styles.eyebrow}>Sealed commitment</p>
        <h2 id="commitment-title">{isReplacement ? "Replace commitment" : "Submit commitment"}</h2>
        <p>
          Enter an amount in {auction.currency}. Only a cryptographic commitment is sent to
          the server during this phase.
        </p>
        {isReplacement ? <p className={styles.warning}>{replacementBidMessage}</p> : null}
      </div>

      <form className={styles.form} onSubmit={handleSubmit}>
        <label className={styles.field}>
          <span>Bid amount</span>
          <div className={styles.amountControl}>
            <input
              required
              inputMode="decimal"
              placeholder="125.00"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
            />
            <span>{auction.currency}</span>
          </div>
        </label>

        {isReplacement ? (
          <label className={styles.check}>
            <input
              type="checkbox"
              checked={confirmedReplacement}
              onChange={(event) => setConfirmedReplacement(event.target.checked)}
            />
            <span>I understand this new bid replaces my previous bid and the previous receipt will no longer work.</span>
          </label>
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

        {state.type === "success" ? (
          <p className={styles.success} aria-live="polite">
            {state.message}
          </p>
        ) : null}

        <button className={styles.primaryButton} type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Submitting..." : isReplacement ? "Replace commitment" : "Submit commitment"}
        </button>
      </form>

      {state.type === "success" ? <BidReceiptPanel receipt={state.receipt} /> : null}
    </section>
  );
}

function getSubmissionMessage(error: unknown): string {
  if (error instanceof BidderAuctionClientError) {
    if (error.status === 409) return "Your bid changed elsewhere. Refresh before retrying.";
    if (error.status === 503) return "Auction service is unavailable.";
    return error.message;
  }
  return "The commitment could not be submitted.";
}
