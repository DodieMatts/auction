import { StatusBadge } from "@/components/ui/status-badge";
import type { AuthenticatedUser } from "@/lib/auth/auth-types";

import styles from "./session-summary.module.css";

export function SessionSummary({ user }: { user: AuthenticatedUser }) {
  return (
    <div className={styles.summary} aria-label="Current session">
      <div className={styles.identity}>
        <span className={styles.email}>{user.email}</span>
        <span className={styles.role}>{user.role}</span>
      </div>
      <StatusBadge tone="success">{user.status}</StatusBadge>
    </div>
  );
}
