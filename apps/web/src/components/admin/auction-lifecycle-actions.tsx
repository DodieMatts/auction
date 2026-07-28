"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

import {
  AdminAuctionClientError,
  cancelAuction,
  publishAuction,
  settleAuction,
} from "@/lib/admin/admin-auction-client";
import type { AdminAuction } from "@/lib/admin/admin-auction-types";
import { FormMessage } from "@/components/admin/form-message";

import styles from "./auction-lifecycle-actions.module.css";

interface AuctionLifecycleActionsProps {
  auction: AdminAuction;
  serverTime: string;
}

type ActionState =
  | { type: "idle" }
  | { type: "success"; message: string }
  | { type: "error"; message: string; canRefresh?: boolean };

export function AuctionLifecycleActions({ auction, serverTime }: AuctionLifecycleActionsProps) {
  const router = useRouter();
  const cancellationRequestId = useRef(crypto.randomUUID());
  const settlementRequestId = useRef(crypto.randomUUID());
  const [reason, setReason] = useState("");
  const [state, setState] = useState<ActionState>({ type: "idle" });
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const canCancel =
    auction.status === "DRAFT" ||
    (auction.status === "PUBLISHED" &&
      new Date(serverTime).getTime() < new Date(auction.startTime).getTime());
  const canSettle = auction.status === "PUBLISHED" && auction.phase === "ENDED";

  async function runAction(name: string, action: () => Promise<unknown>, success: string) {
    if (pendingAction) return;
    setPendingAction(name);
    setState({ type: "idle" });

    try {
      await action();
      setState({ type: "success", message: success });
      router.refresh();
    } catch (error) {
      setState({
        type: "error",
        message: actionMessage(error),
        canRefresh: error instanceof AdminAuctionClientError && error.status === 409,
      });
      if (error instanceof AdminAuctionClientError && error.status === 401) {
        router.replace("/login");
      }
    } finally {
      setPendingAction(null);
    }
  }

  return (
    <section className={styles.panel} aria-labelledby="lifecycle-actions-title">
      <div>
        <h2 id="lifecycle-actions-title">Lifecycle actions</h2>
        <p>Actions use the current auction version and PostgreSQL-controlled lifecycle state.</p>
      </div>

      <div className={styles.actions}>
        {auction.status === "DRAFT" ? (
          <button
            type="button"
            className={styles.primaryButton}
            disabled={Boolean(pendingAction)}
            onClick={() => {
              if (confirm("Publish this draft auction?")) {
                void runAction(
                  "publish",
                  () => publishAuction(auction.id, { expectedVersion: auction.version }),
                  "Auction published.",
                );
              }
            }}
          >
            {pendingAction === "publish" ? "Publishing..." : "Publish"}
          </button>
        ) : null}

        {canSettle ? (
          <button
            type="button"
            className={styles.primaryButton}
            disabled={Boolean(pendingAction)}
            onClick={() => {
              if (confirm("Settle this ended auction?")) {
                void runAction(
                  "settle",
                  () =>
                    settleAuction(auction.id, {
                      expectedVersion: auction.version,
                      settlementRequestId: settlementRequestId.current,
                    }),
                  "Auction settled.",
                );
              }
            }}
          >
            {pendingAction === "settle" ? "Settling..." : "Settle"}
          </button>
        ) : null}

        {canCancel ? (
          <form
            className={styles.cancelForm}
            onSubmit={(event) => {
              event.preventDefault();
              const normalizedReason = reason.trim();
              if (!normalizedReason) {
                setState({ type: "error", message: "Enter a cancellation reason." });
                return;
              }
              void runAction(
                "cancel",
                () =>
                  cancelAuction(auction.id, {
                    cancellationRequestId: cancellationRequestId.current,
                    expectedVersion: auction.version,
                    reason: normalizedReason,
                  }),
                "Auction cancelled.",
              );
            }}
          >
            <label>
              <span>Cancellation reason</span>
              <input
                maxLength={500}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
            </label>
            <button type="submit" className={styles.dangerButton} disabled={Boolean(pendingAction)}>
              {pendingAction === "cancel" ? "Cancelling..." : "Cancel"}
            </button>
          </form>
        ) : null}

        {!canCancel && !canSettle && auction.status !== "DRAFT" ? (
          <p className={styles.unavailable}>No lifecycle action is currently available.</p>
        ) : null}
      </div>

      {state.type !== "idle" ? (
        <FormMessage tone={state.type === "success" ? "success" : "danger"}>
          {state.message}
          {state.type === "error" && state.canRefresh ? (
            <button type="button" className={styles.inlineButton} onClick={() => router.refresh()}>
              Refresh
            </button>
          ) : null}
        </FormMessage>
      ) : null}
    </section>
  );
}

function actionMessage(error: unknown): string {
  if (error instanceof AdminAuctionClientError) {
    if (error.status === 409) return "This auction changed elsewhere. Refresh before retrying.";
    if (error.status === 503) return "Auction service is unavailable.";
    return error.message;
  }
  return "The action could not be completed.";
}
