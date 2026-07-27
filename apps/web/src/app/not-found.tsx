import Link from "next/link";

import { AppShell } from "@/components/layout/app-shell";

export default function NotFound() {
  return (
    <AppShell>
      <section aria-labelledby="not-found-title">
        <h1 id="not-found-title">Page not found</h1>
        <p>This page does not exist.</p>
        <Link href="/">Return to Auction House</Link>
      </section>
    </AppShell>
  );
}
