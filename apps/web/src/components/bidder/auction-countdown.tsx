"use client";

import { useEffect, useMemo, useState } from "react";

import {
  calculateServerOffset,
  getAdjustedCurrentTime,
  getPhaseTargetTime,
} from "@/lib/bidder/server-time";
import type { BidderAuction } from "@/lib/bidder/bidder-auction-types";

import styles from "./auction-countdown.module.css";

export function AuctionCountdown({
  auction,
  serverTime,
}: {
  auction: BidderAuction;
  serverTime: string;
}) {
  const offset = useMemo(() => calculateServerOffset(serverTime), [serverTime]);
  const [now, setNow] = useState(() => getAdjustedCurrentTime(offset));
  const target = getPhaseTargetTime(auction);
  const targetDate = target.targetTime ? new Date(target.targetTime) : null;

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(getAdjustedCurrentTime(offset));
    }, 1000);

    return () => window.clearInterval(timer);
  }, [offset]);

  const remaining = targetDate ? Math.max(0, targetDate.getTime() - now.getTime()) : 0;

  return (
    <section className={styles.countdown} aria-labelledby="countdown-title">
      <div>
        <p className={styles.eyebrow}>Server-timed window</p>
        <h2 id="countdown-title">{target ? target.label : "Auction ended"}</h2>
      </div>
      <p className={styles.value} aria-live="polite">
        {targetDate ? formatRemaining(remaining) : "Final state available after settlement"}
      </p>
      <p className={styles.warning}>Final timing is determined by the auction server.</p>
    </section>
  );
}

function formatRemaining(ms: number): string {
  const totalSeconds = Math.ceil(ms / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  return `${minutes}m ${seconds}s`;
}
