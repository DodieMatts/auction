import Link from "next/link";
import type { ReactNode } from "react";

import { LogoutButton } from "@/components/auth/logout-button";
import { SessionSummary } from "@/components/auth/session-summary";
import { AppShell } from "@/components/layout/app-shell";
import {
  DEFAULT_ADMIN_PATH,
  DEFAULT_BIDDER_PATH,
} from "@/lib/auth/auth-constants";
import { requireCurrentUser } from "@/lib/auth/auth-dal";

import styles from "./protected-layout.module.css";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function ProtectedLayout({
  children,
}: {
  children: ReactNode;
}) {
  const user = await requireCurrentUser();
  const navigation =
    user.role === "ADMIN" ? (
      <Link href={DEFAULT_ADMIN_PATH}>Administration</Link>
    ) : (
      <Link href={DEFAULT_BIDDER_PATH}>Auctions</Link>
    );

  return (
    <AppShell
      navigation={<nav className={styles.navigation}>{navigation}</nav>}
      headerActions={
        <div className={styles.actions}>
          <SessionSummary user={user} />
          <LogoutButton />
        </div>
      }
    >
      <div className={styles.content}>{children}</div>
    </AppShell>
  );
}
