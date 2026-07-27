import type { AdminAuction } from "@/lib/admin/admin-auction-types";

import styles from "./admin-dashboard-summary.module.css";

export function AdminDashboardSummary({ auctions }: { auctions: AdminAuction[] }) {
  const totals = {
    total: auctions.length,
    draft: auctions.filter((auction) => auction.status === "DRAFT").length,
    published: auctions.filter((auction) => auction.status === "PUBLISHED").length,
    settled: auctions.filter((auction) => auction.status === "SETTLED").length,
  };

  return (
    <section className={styles.summary} aria-label="Current page auction summary">
      <SummaryItem tone="neutral" label="Total auctions" value={totals.total} text="Current page" />
      <SummaryItem tone="warning" label="Draft auctions" value={totals.draft} text="Needs publication" />
      <SummaryItem tone="success" label="Published auctions" value={totals.published} text="Visible lifecycle" />
      <SummaryItem tone="success" label="Settled auctions" value={totals.settled} text="Finalized" />
    </section>
  );
}

function SummaryItem({
  tone,
  label,
  value,
  text,
}: {
  tone: "success" | "warning" | "neutral";
  label: string;
  value: number;
  text: string;
}) {
  return (
    <article className={`${styles.item} ${styles[tone]}`}>
      <span className={styles.symbol} aria-hidden="true">
        {tone === "success" ? "✓" : tone === "warning" ? "!" : "○"}
      </span>
      <div>
        <h2 className={styles.label}>{label}</h2>
        <p className={styles.value}>{value}</p>
        <p className={styles.text}>{text}</p>
      </div>
    </article>
  );
}
