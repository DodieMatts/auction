export type UserRole = "ADMIN" | "BIDDER";
export type UserStatus = "ACTIVE" | "SUSPENDED";

export interface AuthenticatedUser {
  id: string;
  email: string;
  role: UserRole;
  status: UserStatus;
}

export interface BackendLoginResponse {
  accessToken: string;
  tokenType: "Bearer";
  expiresIn: number;
  user: AuthenticatedUser;
}

export interface BrowserLoginResponse {
  user: AuthenticatedUser;
  expiresIn: number;
  redirectTo: string;
}

export interface BrowserSessionResponse {
  authenticated: true;
  user: AuthenticatedUser;
}

export interface LoginRequest {
  email: string;
  password: string;
  returnTo?: string;
}

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUserRole(value: unknown): value is UserRole {
  return value === "ADMIN" || value === "BIDDER";
}

export function isUserStatus(value: unknown): value is UserStatus {
  return value === "ACTIVE" || value === "SUSPENDED";
}

export function parseAuthenticatedUser(value: unknown): AuthenticatedUser | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;

  if (
    typeof record.id !== "string" ||
    !uuidPattern.test(record.id) ||
    typeof record.email !== "string" ||
    record.email.length === 0 ||
    !isUserRole(record.role) ||
    !isUserStatus(record.status)
  ) {
    return null;
  }

  return {
    id: record.id,
    email: record.email,
    role: record.role,
    status: record.status,
  };
}

export function parseBackendLoginResponse(
  value: unknown,
): BackendLoginResponse | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  const user = parseAuthenticatedUser(record.user);

  if (
    typeof record.accessToken !== "string" ||
    record.accessToken.length === 0 ||
    record.tokenType !== "Bearer" ||
    typeof record.expiresIn !== "number" ||
    !Number.isInteger(record.expiresIn) ||
    record.expiresIn < 60 ||
    record.expiresIn > 86400 ||
    !user
  ) {
    return null;
  }

  return {
    accessToken: record.accessToken,
    tokenType: "Bearer",
    expiresIn: record.expiresIn,
    user,
  };
}
