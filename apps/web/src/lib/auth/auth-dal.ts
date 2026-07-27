import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";

import { ApiError } from "@/lib/api/api-error";
import { serverApiRequest } from "@/lib/api/server-api-client";

import { LOGIN_PATH } from "./auth-constants";
import { getDefaultPathForRole } from "./auth-redirects";
import { getSessionToken } from "./session-cookie";
import type { AuthenticatedUser, UserRole } from "./auth-types";
import { parseAuthenticatedUser } from "./auth-types";

export const getOptionalCurrentUser = cache(
  async (): Promise<AuthenticatedUser | null> => {
    const token = await getSessionToken();

    if (!token) {
      return null;
    }

    try {
      const response = await serverApiRequest<unknown>("/auth/me", {
        accessToken: token,
      });
      const user = parseAuthenticatedUser(response);

      if (!user || user.status !== "ACTIVE") {
        return null;
      }

      return user;
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        return null;
      }

      throw new Error("Unable to validate the current session");
    }
  },
);

export async function requireCurrentUser(): Promise<AuthenticatedUser> {
  const user = await getOptionalCurrentUser();

  if (!user) {
    redirect(LOGIN_PATH);
  }

  return user;
}

export async function requireRole(role: UserRole): Promise<AuthenticatedUser> {
  const user = await requireCurrentUser();

  if (user.role !== role) {
    redirect(getDefaultPathForRole(user.role));
  }

  return user;
}
