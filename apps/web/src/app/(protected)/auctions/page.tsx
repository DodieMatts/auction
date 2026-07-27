import { requireRole } from "@/lib/auth/auth-dal";

import styles from "./auctions-page.module.css";

export default async function AuctionsPage() {
  const user = await requireRole("BIDDER");

  return (
    <section className={styles.page} aria-labelledby="auctions-title">
      <p className={styles.eyebrow}>Bidder workspace</p>
      <h1 id="auctions-title" className={styles.title}>
        Bidder dashboard
      </h1>
      <p className={styles.text}>
        Signed in as <strong>{user.email}</strong>.
      </p>
      <div className={styles.notice}>
        Authenticated auction discovery screens will be added in a later
        milestone.
      </div>
    </section>
  );
}
