"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { LOGIN_PATH } from "@/lib/auth/auth-constants";

import styles from "./logout-button.module.css";

export function LogoutButton() {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleLogout() {
    if (isSubmitting) {
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const response = await fetch("/api/auth/logout", {
        method: "POST",
        cache: "no-store",
      });

      if (!response.ok && response.status !== 204) {
        throw new Error("Logout failed");
      }

      router.replace(LOGIN_PATH);
      router.refresh();
    } catch {
      setError("Sign out is unavailable. Try again.");
      setIsSubmitting(false);
    }
  }

  return (
    <div className={styles.wrapper}>
      <button
        className={styles.button}
        type="button"
        onClick={handleLogout}
        disabled={isSubmitting}
      >
        {isSubmitting ? "Signing out" : "Sign out"}
      </button>
      <span className={styles.error} aria-live="polite">
        {error}
      </span>
    </div>
  );
}
