import Link from "next/link";

import { AuctionForm } from "@/components/admin/auction-form";
import { requireRole } from "@/lib/auth/auth-dal";

import styles from "./new-auction-page.module.css";

export const dynamic = "force-dynamic";

export default async function NewAuctionPage() {
  await requireRole("ADMIN");

  return (
    <section className={styles.page} aria-labelledby="new-auction-title">
      <div className={styles.header}>
        <Link href="/admin/auctions">Back to auctions</Link>
        <h1 id="new-auction-title">Create draft auction</h1>
        <p>
          Start begins commitments. Reveal opens sealed bids. End allows administrator
          settlement.
        </p>
      </div>

      <div className={styles.module}>
        <AuctionForm mode="create" />
      </div>
    </section>
  );
}
