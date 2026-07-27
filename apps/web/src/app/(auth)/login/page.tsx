import { redirect } from "next/navigation";

import { AppShell } from "@/components/layout/app-shell";
import { LoginForm } from "@/components/auth/login-form";
import { getOptionalCurrentUser } from "@/lib/auth/auth-dal";
import { getPostLoginPath, sanitizeReturnPath } from "@/lib/auth/auth-redirects";

import styles from "./login-page.module.css";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function LoginPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const resolvedSearchParams = await searchParams;
  const rawNext = Array.isArray(resolvedSearchParams?.next)
    ? resolvedSearchParams?.next[0]
    : resolvedSearchParams?.next;
  const returnTo = sanitizeReturnPath(rawNext);
  const user = await getOptionalCurrentUser();

  if (user) {
    redirect(getPostLoginPath(user.role, returnTo));
  }

  return (
    <AppShell>
      <div className={styles.layout}>
        <section className={styles.copy} aria-labelledby="login-title">
          <p className={styles.eyebrow}>Secure session</p>
          <h1 id="login-title" className={styles.title}>
            Sign in
          </h1>
          <p className={styles.text}>
            Your session is stored in an HTTP-only cookie. Browser JavaScript
            cannot read the backend access token.
          </p>
          <p className={styles.notice}>
            Local development accounts are seeded from backend environment
            settings. Credentials are not embedded in this page.
          </p>
        </section>
        <LoginForm returnTo={returnTo} />
      </div>
    </AppShell>
  );
}
