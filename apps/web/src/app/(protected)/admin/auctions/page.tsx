import Link from "next/link";

import { AuctionList } from "@/components/admin/auction-list";
import { Pagination } from "@/components/admin/pagination";
import { listAdminAuctions } from "@/lib/admin/admin-auctions-api";
import { requireRole } from "@/lib/auth/auth-dal";
import type { AuctionStatus } from "@/lib/admin/admin-auction-types";

import styles from "./auctions-page.module.css";

export const dynamic = "force-dynamic";

const statuses: AuctionStatus[] = ["DRAFT", "PUBLISHED", "CANCELLED", "SETTLED"];

interface AdminAuctionsPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function AdminAuctionsPage({ searchParams }: AdminAuctionsPageProps) {
  await requireRole("ADMIN");
  const params = await searchParams;
  const page = parseInteger(params.page, 1, 100000, 1);
  const limit = parseInteger(params.limit, 1, 100, 20);
  const status = parseStatus(params.status);
  const result = await loadAuctions({ page, limit, status });

  return (
    <section className={styles.page} aria-labelledby="auctions-title">
      <div className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Administrator auctions</p>
          <h1 id="auctions-title">Auctions</h1>
          <p>Manage draft scheduling, publishing, cancellation, settlement, and results.</p>
        </div>
        <Link className={styles.primaryLink} href="/admin/auctions/new">
          Create auction
        </Link>
      </div>

      <nav className={styles.filters} aria-label="Auction status filters">
        <FilterLink label="All" href="/admin/auctions" active={!status} />
        {statuses.map((value) => (
          <FilterLink
            key={value}
            label={value}
            href={`/admin/auctions?status=${value}`}
            active={status === value}
          />
        ))}
      </nav>

      <section className={styles.module}>
        {result ? (
          <>
            {result.data.length > 0 ? (
              <AuctionList auctions={result.data} />
            ) : (
              <p className={styles.empty}>
                {status ? "No auctions match this filter." : "No auctions exist yet."}
              </p>
            )}
            <Pagination
              pagination={result.pagination}
              status={status}
            />
          </>
        ) : (
          <p className={styles.empty}>Auction details are unavailable.</p>
        )}
      </section>
    </section>
  );
}

function FilterLink({
  label,
  href,
  active,
}: {
  label: string;
  href: string;
  active: boolean;
}) {
  return (
    <Link className={active ? styles.activeFilter : styles.filter} href={href}>
      {label}
    </Link>
  );
}

async function loadAuctions(query: {
  page: number;
  limit: number;
  status?: AuctionStatus;
}) {
  try {
    return await listAdminAuctions(query);
  } catch {
    return null;
  }
}

function parseInteger(
  value: string | string[] | undefined,
  min: number,
  max: number,
  fallback: number,
) {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw || !/^\d+$/.test(raw)) return fallback;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

function parseStatus(value: string | string[] | undefined): AuctionStatus | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  return statuses.includes(raw as AuctionStatus) ? (raw as AuctionStatus) : undefined;
}
