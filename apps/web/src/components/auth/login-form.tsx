"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useId, useState } from "react";

import type { BrowserLoginResponse } from "@/lib/auth/auth-types";

import styles from "./login-form.module.css";

type FormState = "idle" | "submitting" | "success" | "error";

export function LoginForm({ returnTo }: { returnTo: string | null }) {
  const router = useRouter();
  const errorId = useId();
  const [state, setState] = useState<FormState>("idle");
  const [message, setMessage] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;

    if (state === "submitting") {
      return;
    }

    const formData = new FormData(form);
    const email = formData.get("email");
    const password = formData.get("password");

    setState("submitting");
    setMessage(null);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        cache: "no-store",
        body: JSON.stringify({
          email,
          password,
          ...(returnTo ? { returnTo } : {}),
        }),
      });

      const payload = (await response.json().catch(() => null)) as
        | Partial<BrowserLoginResponse>
        | null;

      if (!response.ok) {
        throw new Error("Sign in failed");
      }

      if (
        !payload ||
        typeof payload.redirectTo !== "string" ||
        !payload.user ||
        typeof payload.expiresIn !== "number"
      ) {
        throw new Error("Malformed sign in response");
      }

      setState("success");
      router.replace(payload.redirectTo);
      router.refresh();
    } catch {
      const passwordInput = form.elements.namedItem("password");

      if (passwordInput instanceof HTMLInputElement) {
        passwordInput.value = "";
      }

      setState("error");
      setMessage("Sign in failed. Check your credentials and try again.");
    }
  }

  const isSubmitting = state === "submitting";

  return (
    <form className={styles.form} onSubmit={handleSubmit} noValidate>
      <div className={styles.field}>
        <label className={styles.label} htmlFor="email">
          Email
        </label>
        <input
          className={styles.input}
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          required
          maxLength={320}
          disabled={isSubmitting}
        />
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="password">
          Password
        </label>
        <input
          className={styles.input}
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          minLength={8}
          maxLength={128}
          disabled={isSubmitting}
          aria-describedby={message ? errorId : undefined}
        />
      </div>

      <div
        id={errorId}
        className={styles.message}
        role={message ? "alert" : undefined}
        aria-live="polite"
      >
        {message}
      </div>

      <button className={styles.submit} type="submit" disabled={isSubmitting}>
        {isSubmitting ? "Signing in" : "Sign in"}
      </button>
    </form>
  );
}
