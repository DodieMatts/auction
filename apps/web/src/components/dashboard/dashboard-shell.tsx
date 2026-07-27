import type { ReactNode } from "react";

import type { AuthenticatedUser } from "@/lib/auth/auth-types";
import { LogoutButton } from "@/components/auth/logout-button";
import { SessionSummary } from "@/components/auth/session-summary";

import { DashboardHeader } from "./dashboard-header";
import { DashboardNavigation, type DashboardNavItem } from "./dashboard-navigation";
import styles from "./dashboard-shell.module.css";

export function DashboardShell({
  user,
  navigationItems,
  children,
}: {
  user: AuthenticatedUser;
  navigationItems: DashboardNavItem[];
  children: ReactNode;
}) {
  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar} aria-label="Primary navigation">
        <div className={styles.sidebarBrand}>
          <span className={styles.brandTitle}>Auction House</span>
          <span className={styles.brandSubtitle}>Administration</span>
        </div>
        <DashboardNavigation items={navigationItems} />
      </aside>
      <div className={styles.workspace}>
        <DashboardHeader
          userSummary={<SessionSummary user={user} compact />}
          logoutAction={<LogoutButton />}
        />
        <main className={styles.main}>{children}</main>
      </div>
    </div>
  );
}
