import { BidderAuctionList } from "@/components/bidder/bidder-auction-list";
import { BidderPagination } from "@/components/bidder/bidder-pagination";
import { listBidderAuctions } from "@/lib/bidder/bidder-auctions-api";
import { requireRole } from "@/lib/auth/auth-dal";

import styles from "./auctions-page.module.css";

export const dynamic = "force-dynamic";

interface BidderAuctionsPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function BidderAuctionsPage({ searchParams }: BidderAuctionsPageProps) {
  const user = await requireRole("BIDDER");
  const params = await searchParams;
  const page = parseInteger(params.page, 1, 100000, 1);
  const limit = parseInteger(params.limit, 1, 100, 20);
  const result = await loadAuctions(page, limit);

  return (
    <section className={styles.page} aria-labelledby="auctions-title">
      <div className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Bidder auctions</p>
          <h1 id="auctions-title">Available auctions</h1>
          <p>
            Browse published and settled auctions. Commitments, reveals, and results are
            handled from the auction detail page.
          </p>
        </div>
        <p className={styles.identity}>Signed in as {user.email}</p>
      </div>

      {result ? (
        <>
          <BidderAuctionList auctions={result.data} />
          <BidderPagination pagination={result.pagination} />
        </>
      ) : (
        <p className={styles.empty}>Auction details are unavailable.</p>
      )}
    </section>
  );
}

async function loadAuctions(page: number, limit: number) {
  try {
    return await listBidderAuctions({ page, limit });
  } catch {
    return null;
  }
}

function parseInteger(
  value: string | string[] | undefined,
  min: number,
  max: number,
  fallback: number,
) {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw || !/^\d+$/.test(raw)) return fallback;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}
