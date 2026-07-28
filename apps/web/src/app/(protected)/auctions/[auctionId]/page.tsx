import Link from "next/link";
import { notFound } from "next/navigation";

import { AuctionCountdown } from "@/components/bidder/auction-countdown";
import { BidCommitmentForm } from "@/components/bidder/bid-commitment-form";
import { BidParticipationSummary } from "@/components/bidder/bid-participation-summary";
import { BidRevealForm } from "@/components/bidder/bid-reveal-form";
import { BidderAuctionMetadata } from "@/components/bidder/bidder-auction-metadata";
import { BidderResultSummary } from "@/components/bidder/bidder-result-summary";
import { ApiError } from "@/lib/api/api-error";
import {
  getBidParticipation,
  getBidRevealStatus,
  getBidderAuction,
  getBidderAuctionResults,
} from "@/lib/bidder/bidder-auctions-api";
import type { BidderAuctionResultResponse } from "@/lib/bidder/bidder-auction-types";
import { requireRole } from "@/lib/auth/auth-dal";

import styles from "./auction-detail-page.module.css";

export const dynamic = "force-dynamic";

interface BidderAuctionDetailPageProps {
  params: Promise<{ auctionId: string }>;
}

export default async function BidderAuctionDetailPage({
  params,
}: BidderAuctionDetailPageProps) {
  const user = await requireRole("BIDDER");
  const { auctionId } = await params;
  const auctionResponse = await loadAuction(auctionId);
  const auction = auctionResponse.auction;
  const [participation, revealStatus, result] = await Promise.all([
    getBidParticipation(auction.id),
    loadRevealStatus(auction.id),
    loadResult(auction.id),
  ]);

  return (
    <section className={styles.page} aria-labelledby="auction-title">
      <Link className={styles.backLink} href="/auctions">
        Back to auctions
      </Link>

      <div className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Auction detail</p>
          <h1 id="auction-title">{auction.title}</h1>
          <p>{auction.description || "No description provided."}</p>
        </div>
      </div>

      <div className={styles.grid}>
        <section className={styles.module} aria-labelledby="metadata-title">
          <h2 id="metadata-title">Schedule and phase</h2>
          <BidderAuctionMetadata auction={auction} />
        </section>
        <AuctionCountdown auction={auction} serverTime={auctionResponse.serverTime} />
      </div>

      <BidParticipationSummary
        participation={participation}
        revealStatus={revealStatus}
        result={result}
      />

      {auction.phase === "COMMIT" && participation.canCommit ? (
        <BidCommitmentForm auction={auction} user={user} participation={participation} />
      ) : null}

      {auction.phase === "REVEAL" && revealStatus?.canReveal ? (
        <BidRevealForm auction={auction} user={user} revealStatus={revealStatus} />
      ) : null}

      {result ? <BidderResultSummary result={result} /> : null}
    </section>
  );
}

async function loadAuction(auctionId: string) {
  try {
    return await getBidderAuction(auctionId);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }
}

async function loadRevealStatus(auctionId: string) {
  try {
    return await getBidRevealStatus(auctionId);
  } catch {
    return null;
  }
}

async function loadResult(auctionId: string): Promise<BidderAuctionResultResponse | null> {
  try {
    return await getBidderAuctionResults(auctionId);
  } catch (error) {
    if (error instanceof ApiError && error.status === 409) return null;
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}
