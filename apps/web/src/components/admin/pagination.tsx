import Link from "next/link";

import type { AuctionStatus, PaginationMetadata } from "@/lib/admin/admin-auction-types";

import styles from "./pagination.module.css";

export function Pagination({
  pagination,
  status,
}: {
  pagination: PaginationMetadata;
  status?: AuctionStatus;
}) {
  const previousPage = pagination.page - 1;
  const nextPage = pagination.page + 1;

  return (
    <nav className={styles.pagination} aria-label="Auction pagination">
      {previousPage >= 1 ? (
        <Link href={hrefFor(previousPage, pagination.limit, status)}>Previous</Link>
      ) : (
        <span aria-disabled="true">Previous</span>
      )}
      <span>
        Page {pagination.page} of {pagination.totalPages || 1}
      </span>
      {nextPage <= pagination.totalPages ? (
        <Link href={hrefFor(nextPage, pagination.limit, status)}>Next</Link>
      ) : (
        <span aria-disabled="true">Next</span>
      )}
    </nav>
  );
}

function hrefFor(page: number, limit: number, status?: AuctionStatus): string {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (status) params.set("status", status);
  return `/admin/auctions?${params.toString()}`;
}
