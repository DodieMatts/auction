import { requireRole } from "@/lib/auth/auth-dal";
import { listAdminAuctions } from "@/lib/admin/admin-auctions-api";
import { AdminDashboardSummary } from "@/components/admin/admin-dashboard-summary";
import { AuctionList } from "@/components/admin/auction-list";
import Link from "next/link";

import styles from "./admin-page.module.css";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const user = await requireRole("ADMIN");
  const auctionsResult = await loadDashboardAuctions();
  const auctions = auctionsResult?.data ?? [];

  return (
    <section className={styles.page} aria-labelledby="admin-title">
      <div className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Administrator workspace</p>
          <h1 id="admin-title" className={styles.title}>
            Administrator dashboard
          </h1>
          <p className={styles.text}>
            Signed in as <strong>{user.email}</strong>. Current-page summaries are based on the
            most recent auctions loaded for this dashboard.
          </p>
        </div>
        <div className={styles.actions}>
          <Link className={styles.primaryLink} href="/admin/auctions/new">
            Create auction
          </Link>
          <Link className={styles.secondaryLink} href="/admin/auctions">
            View all auctions
          </Link>
        </div>
      </div>

      <AdminDashboardSummary auctions={auctions} />

      <section className={styles.module} aria-labelledby="recent-auctions-title">
        <div className={styles.moduleHeader}>
          <div>
            <h2 id="recent-auctions-title">Recent auctions</h2>
            <p>Latest administrator-visible auctions.</p>
          </div>
          <Link href="/admin/auctions">All auctions</Link>
        </div>

        {auctionsResult ? (
          <AuctionList auctions={auctions} />
        ) : (
          <p className={styles.empty}>Auction details are unavailable.</p>
        )}
      </section>
    </section>
  );
}

async function loadDashboardAuctions() {
  try {
    return await listAdminAuctions({ page: 1, limit: 5 });
  } catch {
    return null;
  }
}
