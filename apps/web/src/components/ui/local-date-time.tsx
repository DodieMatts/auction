"use client";

import { formatLocalDateTime } from "@/lib/date-time";

export function LocalDateTime({
  value,
  fallback = "Not set",
}: {
  value: string | null;
  fallback?: string;
}) {
  if (!value) return <span>{fallback}</span>;

  return (
    <time dateTime={value} suppressHydrationWarning>
      {formatLocalDateTime(value)}
    </time>
  );
}
