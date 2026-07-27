import Link from "next/link";
import { notFound } from "next/navigation";

import { ApiError } from "@/lib/api/api-error";
import { requireRole } from "@/lib/auth/auth-dal";
import {
  getAdminAuction,
  getAdminAuctionResults,
} from "@/lib/admin/admin-auctions-api";
import { AuctionForm } from "@/components/admin/auction-form";
import { AuctionLifecycleActions } from "@/components/admin/auction-lifecycle-actions";
import { AuctionMetadata } from "@/components/admin/auction-metadata";
import { AuctionResultSummary } from "@/components/admin/auction-result-summary";
import { AuctionStatusBadge } from "@/components/admin/auction-status-badge";

import styles from "./auction-detail-page.module.css";

export const dynamic = "force-dynamic";

interface AuctionDetailPageProps {
  params: Promise<{ auctionId: string }>;
}

export default async function AuctionDetailPage({ params }: AuctionDetailPageProps) {
  await requireRole("ADMIN");
  const { auctionId } = await params;
  const detail = await loadDetail(auctionId);
  if (!detail) notFound();
  const result = detail.auction.status === "SETTLED" ? await loadResult(auctionId) : null;

  return (
    <section className={styles.page} aria-labelledby="auction-detail-title">
      <div className={styles.header}>
        <div>
          <Link href="/admin/auctions">Back to auctions</Link>
          <div className={styles.titleRow}>
            <h1 id="auction-detail-title">{detail.auction.title}</h1>
            <AuctionStatusBadge value={detail.auction.phase} kind="phase" />
          </div>
          <p>{detail.auction.description ?? "No description provided."}</p>
        </div>
      </div>

      <section className={styles.module} aria-labelledby="auction-metadata-title">
        <h2 id="auction-metadata-title">Auction details</h2>
        <AuctionMetadata auction={detail.auction} />
      </section>

      <section className={styles.module} aria-labelledby="auction-actions-title">
        <h2 id="auction-actions-title">Manage lifecycle</h2>
        <AuctionLifecycleActions auction={detail.auction} serverTime={detail.serverTime} />
      </section>

      {detail.auction.status === "DRAFT" ? (
        <section className={styles.module} aria-labelledby="edit-auction-title">
          <h2 id="edit-auction-title">Edit draft</h2>
          <AuctionForm mode="edit" auction={detail.auction} />
        </section>
      ) : null}

      {result ? (
        <div className={styles.module}>
          <AuctionResultSummary result={result} />
        </div>
      ) : null}
    </section>
  );
}

async function loadDetail(auctionId: string) {
  try {
    return await getAdminAuction(auctionId);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}

async function loadResult(auctionId: string) {
  try {
    return await getAdminAuctionResults(auctionId);
  } catch {
    return null;
  }
}
