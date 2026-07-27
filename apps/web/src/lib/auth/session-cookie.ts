import "server-only";

import { cookies } from "next/headers";

import { AUTH_COOKIE_NAME } from "./auth-constants";

const minSessionAgeSeconds = 60;
const maxSessionAgeSeconds = 86400;

export async function getSessionToken(): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get(AUTH_COOKIE_NAME)?.value ?? null;
}

export async function setSessionToken({
  token,
  expiresIn,
}: {
  token: string;
  expiresIn: number;
}): Promise<void> {
  if (
    typeof token !== "string" ||
    token.length === 0 ||
    !Number.isInteger(expiresIn) ||
    expiresIn < minSessionAgeSeconds ||
    expiresIn > maxSessionAgeSeconds
  ) {
    throw new Error("Invalid session cookie settings");
  }

  const cookieStore = await cookies();
  cookieStore.set(AUTH_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    priority: "high",
    maxAge: expiresIn,
  });
}

export async function deleteSessionToken(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(AUTH_COOKIE_NAME);
}
