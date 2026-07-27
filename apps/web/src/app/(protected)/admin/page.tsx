import { requireRole } from "@/lib/auth/auth-dal";

import styles from "./admin-page.module.css";

export default async function AdminPage() {
  const user = await requireRole("ADMIN");

  return (
    <section className={styles.page} aria-labelledby="admin-title">
      <p className={styles.eyebrow}>Administrator workspace</p>
      <h1 id="admin-title" className={styles.title}>
        Administrator dashboard
      </h1>
      <p className={styles.text}>
        Signed in as <strong>{user.email}</strong>.
      </p>
      <div className={styles.notice}>
        Auction management screens will be added in a later milestone.
      </div>
    </section>
  );
}
