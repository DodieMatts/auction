import {
  DEFAULT_ADMIN_PATH,
  DEFAULT_BIDDER_PATH,
} from "./auth-constants";
import type { UserRole } from "./auth-types";

const maxReturnPathLength = 500;

export function getDefaultPathForRole(role: UserRole): string {
  return role === "ADMIN" ? DEFAULT_ADMIN_PATH : DEFAULT_BIDDER_PATH;
}

export function sanitizeReturnPath(value: unknown): string | null {
  if (typeof value !== "string" || value.length > maxReturnPathLength) {
    return null;
  }

  if (
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\") ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    return null;
  }

  try {
    const parsed = new URL(value, "http://local.invalid");

    if (parsed.origin !== "http://local.invalid") {
      return null;
    }

    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return null;
  }
}

export function getPostLoginPath(role: UserRole, returnTo: unknown): string {
  const defaultPath = getDefaultPathForRole(role);
  const sanitized = sanitizeReturnPath(returnTo);

  if (!sanitized) {
    return defaultPath;
  }

  if (role === "ADMIN" && isPathUnder(sanitized, DEFAULT_ADMIN_PATH)) {
    return sanitized;
  }

  if (role === "BIDDER" && isPathUnder(sanitized, DEFAULT_BIDDER_PATH)) {
    return sanitized;
  }

  return defaultPath;
}

function isPathUnder(path: string, basePath: string): boolean {
  return path === basePath || path.startsWith(`${basePath}/`);
}
