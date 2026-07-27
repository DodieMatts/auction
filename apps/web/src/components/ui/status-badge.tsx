import styles from "./status-badge.module.css";

export type StatusBadgeTone = "success" | "warning" | "danger" | "neutral";

export function StatusBadge({
  tone,
  children,
}: {
  tone: StatusBadgeTone;
  children: string;
}) {
  return (
    <span className={`${styles.badge} ${styles[tone]}`}>
      <span className={styles.indicator} aria-hidden="true" />
      <span>{children}</span>
    </span>
  );
}
