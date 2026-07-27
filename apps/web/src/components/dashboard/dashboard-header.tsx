import type { ReactNode } from "react";

import styles from "./dashboard-header.module.css";

export function DashboardHeader({
  userSummary,
  logoutAction,
}: {
  userSummary: ReactNode;
  logoutAction: ReactNode;
}) {
  return (
    <header className={styles.header}>
      <div className={styles.titleGroup}>
        <span className={styles.product}>Auction House</span>
        <span className={styles.context}>Secure sealed-bid auctions</span>
      </div>
      <div className={styles.account}>
        {userSummary}
        {logoutAction}
      </div>
    </header>
  );
}
