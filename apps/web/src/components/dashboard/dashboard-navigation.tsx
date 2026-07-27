"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import styles from "./dashboard-navigation.module.css";

export interface DashboardNavItem {
  href: string;
  label: string;
}

export function DashboardNavigation({ items }: { items: DashboardNavItem[] }) {
  const pathname = usePathname();

  return (
    <nav className={styles.navigation} aria-label="Dashboard navigation">
      {items.map((item) => {
        const active =
          pathname === item.href ||
          (item.href !== "/admin" && pathname.startsWith(`${item.href}/`));

        return (
          <Link
            key={item.href}
            className={active ? styles.activeLink : styles.link}
            href={item.href}
            aria-current={active ? "page" : undefined}
          >
            <span className={styles.symbol} aria-hidden="true">
              {active ? "●" : "○"}
            </span>
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
