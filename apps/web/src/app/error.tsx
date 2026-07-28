"use client";

import { AppShell } from "@/components/layout/app-shell";

import styles from "./error.module.css";

export default function Error({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <AppShell>
      <section className={styles.container} aria-labelledby="error-title">
        <h1 id="error-title" className={styles.title}>
          Something went wrong
        </h1>
        <p className={styles.text}>
          The application could not complete this request. Try again when you are
          ready.
        </p>
        <button className={styles.button} type="button" onClick={reset}>
          Retry
        </button>
      </section>
    </AppShell>
  );
}
