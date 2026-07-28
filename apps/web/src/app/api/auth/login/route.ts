import { ApiError } from "@/lib/api/api-error";
import { serverApiRequest } from "@/lib/api/server-api-client";
import { getPostLoginPath } from "@/lib/auth/auth-redirects";
import type { BackendLoginResponse, LoginRequest } from "@/lib/auth/auth-types";
import { parseBackendLoginResponse } from "@/lib/auth/auth-types";
import { assertSameOriginRequest } from "@/lib/auth/same-origin-request";
import { setSessionToken } from "@/lib/auth/session-cookie";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const maxBodyBytes = 4096;
const noStoreHeaders = {
  "Cache-Control": "no-store",
  Pragma: "no-cache",
  Vary: "Cookie",
};

export async function POST(request: Request): Promise<Response> {
  const originFailure = assertSameOriginRequest(request);

  if (originFailure) {
    return originFailure;
  }

  const parsedRequest = await parseLoginRequest(request);

  if (!parsedRequest.ok) {
    return jsonResponse({ message: "Malformed login request" }, 400);
  }

  try {
    const backendResponse = await serverApiRequest<BackendLoginResponse>(
      "/auth/login",
      {
        method: "POST",
        body: {
          email: parsedRequest.value.email,
          password: parsedRequest.value.password,
        },
      },
    );
    const loginResponse = parseBackendLoginResponse(backendResponse);

    if (!loginResponse) {
      return jsonResponse({ message: "Authentication service unavailable" }, 503);
    }

    await setSessionToken({
      token: loginResponse.accessToken,
      expiresIn: loginResponse.expiresIn,
    });

    return jsonResponse(
      {
        user: loginResponse.user,
        expiresIn: loginResponse.expiresIn,
        redirectTo: getPostLoginPath(
          loginResponse.user.role,
          parsedRequest.value.returnTo,
        ),
      },
      200,
    );
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      return jsonResponse({ message: "Invalid email or password" }, 401);
    }

    return jsonResponse({ message: "Authentication service unavailable" }, 503);
  }
}

async function parseLoginRequest(
  request: Request,
): Promise<{ ok: true; value: LoginRequest } | { ok: false }> {
  const contentType = request.headers.get("content-type") ?? "";

  if (!contentType.toLowerCase().includes("application/json")) {
    return { ok: false };
  }

  const text = await request.text();

  if (new TextEncoder().encode(text).byteLength > maxBodyBytes) {
    return { ok: false };
  }

  let value: unknown;

  try {
    value = JSON.parse(text);
  } catch {
    return { ok: false };
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false };
  }

  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);

  if (!keys.every((key) => ["email", "password", "returnTo"].includes(key))) {
    return { ok: false };
  }

  if (
    typeof record.email !== "string" ||
    typeof record.password !== "string" ||
    record.email.length < 1 ||
    record.email.length > 320 ||
    record.password.length < 8 ||
    record.password.length > 128 ||
    (record.returnTo !== undefined && typeof record.returnTo !== "string")
  ) {
    return { ok: false };
  }

  return {
    ok: true,
    value: {
      email: record.email.trim().toLowerCase(),
      password: record.password,
      returnTo: record.returnTo,
    },
  };
}

function jsonResponse(body: unknown, status: number): Response {
  return Response.json(body, {
    status,
    headers: noStoreHeaders,
  });
}
