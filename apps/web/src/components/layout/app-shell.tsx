import type { ReactNode } from "react";

import styles from "./app-shell.module.css";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <div className={styles.brand}>
            <p className={styles.title}>Auction House</p>
            <p className={styles.subtitle}>Secure sealed-bid auctions</p>
          </div>
        </div>
      </header>
      <main className={styles.main}>{children}</main>
      <footer className={styles.footer}>
        <div className={styles.footerInner}>
          <span>Auction House foundation</span>
        </div>
      </footer>
    </div>
  );
}
