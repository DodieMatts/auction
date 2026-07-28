import type { ReactNode } from "react";

import styles from "./form-message.module.css";

export function FormMessage({
  tone,
  children,
}: {
  tone: "success" | "warning" | "danger" | "neutral";
  children: ReactNode;
}) {
  return (
    <p className={`${styles.message} ${styles[tone]}`} aria-live="polite">
      {children}
    </p>
  );
}
