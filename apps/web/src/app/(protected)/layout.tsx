import type { ReactNode } from "react";

import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import {
  DEFAULT_ADMIN_PATH,
  DEFAULT_BIDDER_PATH,
} from "@/lib/auth/auth-constants";
import { requireCurrentUser } from "@/lib/auth/auth-dal";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function ProtectedLayout({
  children,
}: {
  children: ReactNode;
}) {
  const user = await requireCurrentUser();
  const navigationItems =
    user.role === "ADMIN"
      ? [
          { href: DEFAULT_ADMIN_PATH, label: "Dashboard" },
          { href: `${DEFAULT_ADMIN_PATH}/auctions`, label: "Auctions" },
        ]
      : [{ href: DEFAULT_BIDDER_PATH, label: "Auctions" }];

  return (
    <DashboardShell user={user} navigationItems={navigationItems}>
      {children}
    </DashboardShell>
  );
}
