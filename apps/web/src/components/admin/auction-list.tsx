import Link from "next/link";

import { formatAuctionDateTime } from "@/lib/admin/admin-auction-formatters";
import type { AdminAuction } from "@/lib/admin/admin-auction-types";

import { AuctionStatusBadge } from "./auction-status-badge";
import styles from "./auction-list.module.css";

export function AuctionList({ auctions }: { auctions: AdminAuction[] }) {
  if (auctions.length === 0) {
    return <p className={styles.empty}>No auctions match this filter.</p>;
  }

  return (
    <div className={styles.wrapper}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Title</th>
            <th>Status</th>
            <th>Phase</th>
            <th>Start</th>
            <th>Reveal</th>
            <th>End</th>
            <th>Version</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {auctions.map((auction) => (
            <tr key={auction.id}>
              <td data-label="Title">{auction.title}</td>
              <td data-label="Status">
                <AuctionStatusBadge value={auction.status} kind="status" />
              </td>
              <td data-label="Phase">
                <AuctionStatusBadge value={auction.phase} kind="phase" />
              </td>
              <td data-label="Start">{formatAuctionDateTime(auction.startTime)}</td>
              <td data-label="Reveal">{formatAuctionDateTime(auction.revealTime)}</td>
              <td data-label="End">{formatAuctionDateTime(auction.endTime)}</td>
              <td data-label="Version">{auction.version}</td>
              <td data-label="Actions">
                <Link className={styles.link} href={`/admin/auctions/${auction.id}`}>
                  Details
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
