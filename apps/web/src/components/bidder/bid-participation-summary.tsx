import { formatAuctionDateTime } from "@/lib/bidder/bidder-auction-formatters";
import type {
  BidParticipationResponse,
  BidRevealStatusResponse,
  BidderAuctionResultResponse,
} from "@/lib/bidder/bidder-auction-types";

import { BidStatusPill, BidderOutcomeStatus } from "./bidder-auction-status";
import styles from "./bid-participation-summary.module.css";

export function BidParticipationSummary({
  participation,
  revealStatus,
  result,
}: {
  participation: BidParticipationResponse;
  revealStatus: BidRevealStatusResponse | null;
  result: BidderAuctionResultResponse | null;
}) {
  const state = getState(participation, revealStatus, result);

  return (
    <section className={styles.summary} aria-labelledby="participation-title">
      <div className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Your participation</p>
          <h2 id="participation-title">{state.title}</h2>
        </div>
        {result ? (
          <BidderOutcomeStatus outcome={result.result.yourOutcome.status} />
        ) : (
          <BidStatusPill tone={state.tone} label={state.badge} />
        )}
      </div>

      <p>{state.description}</p>

      {participation.participation ? (
        <dl className={styles.details}>
          <div>
            <dt>Bid version</dt>
            <dd>{participation.participation.version}</dd>
          </div>
          <div>
            <dt>Current commitment time</dt>
            <dd>
              {formatAuctionDateTime(participation.participation.currentCommitment.committedAt)}
            </dd>
          </div>
          {revealStatus?.validReveal ? (
            <div>
              <dt>Reveal submitted</dt>
              <dd>{formatAuctionDateTime(revealStatus.validReveal.submittedAt)}</dd>
            </div>
          ) : null}
          {revealStatus && revealStatus.invalidAttemptCount > 0 ? (
            <div>
              <dt>Invalid attempts</dt>
              <dd>{revealStatus.invalidAttemptCount}</dd>
            </div>
          ) : null}
        </dl>
      ) : null}
    </section>
  );
}

function getState(
  participation: BidParticipationResponse,
  revealStatus: BidRevealStatusResponse | null,
  result: BidderAuctionResultResponse | null,
) {
  if (result) {
    return {
      title: "Result finalized",
      badge: result.result.yourOutcome.status,
      tone: "success" as const,
      description: "Settlement is complete. Your personal outcome is shown below.",
    };
  }

  if (!participation.participation) {
    return {
      title: "No commitment submitted",
      badge: "No commitment",
      tone: "neutral" as const,
      description: "You have not submitted a sealed commitment for this auction.",
    };
  }

  if (revealStatus?.validReveal || participation.participation.status === "REVEALED") {
    return {
      title: "Bid revealed",
      badge: "Revealed",
      tone: "success" as const,
      description: "Your bid has been revealed and is awaiting settlement.",
    };
  }

  if (participation.phase === "REVEAL" && revealStatus?.canReveal) {
    return {
      title: "Reveal available",
      badge: "Reveal",
      tone: "warning" as const,
      description: "Import your saved reveal receipt before the reveal window closes.",
    };
  }

  return {
    title: "Commitment active",
    badge: "Committed",
    tone: "success" as const,
    description: "Your current sealed commitment is active. Keep the latest receipt safe.",
  };
}
