import Link from "next/link";

import type { PaginationMetadata } from "@/lib/bidder/bidder-auction-types";

import styles from "./bidder-pagination.module.css";

export function BidderPagination({ pagination }: { pagination: PaginationMetadata }) {
  const previousPage = Math.max(1, pagination.page - 1);
  const nextPage = pagination.page + 1;
  const hasPrevious = pagination.page > 1;
  const hasNext = pagination.totalPages > 0 && pagination.page < pagination.totalPages;

  return (
    <nav className={styles.pagination} aria-label="Auction pagination">
      {hasPrevious ? (
        <Link href={hrefFor(previousPage, pagination.limit)}>Previous</Link>
      ) : (
        <span aria-disabled="true">Previous</span>
      )}
      <span>
        Page {pagination.totalPages === 0 ? 0 : pagination.page} of {pagination.totalPages}
      </span>
      {hasNext ? (
        <Link href={hrefFor(nextPage, pagination.limit)}>Next</Link>
      ) : (
        <span aria-disabled="true">Next</span>
      )}
    </nav>
  );
}

function hrefFor(page: number, limit: number): string {
  const params = new URLSearchParams();
  params.set("page", String(page));
  params.set("limit", String(limit));
  return `/auctions?${params.toString()}`;
}
