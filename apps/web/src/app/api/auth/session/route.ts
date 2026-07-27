import { ApiError } from "@/lib/api/api-error";
import { serverApiRequest } from "@/lib/api/server-api-client";
import { parseAuthenticatedUser } from "@/lib/auth/auth-types";
import { deleteSessionToken, getSessionToken } from "@/lib/auth/session-cookie";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const noStoreHeaders = {
  "Cache-Control": "no-store",
  Pragma: "no-cache",
  Vary: "Cookie",
};

export async function GET(): Promise<Response> {
  const token = await getSessionToken();

  if (!token) {
    return unauthorizedResponse();
  }

  try {
    const response = await serverApiRequest<unknown>("/auth/me", {
      accessToken: token,
    });
    const user = parseAuthenticatedUser(response);

    if (!user || user.status !== "ACTIVE") {
      await deleteSessionToken();
      return unauthorizedResponse();
    }

    return Response.json(
      {
        authenticated: true,
        user,
      },
      {
        status: 200,
        headers: noStoreHeaders,
      },
    );
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      await deleteSessionToken();
      return unauthorizedResponse();
    }

    return Response.json(
      { message: "Authentication service unavailable" },
      {
        status: 503,
        headers: noStoreHeaders,
      },
    );
  }
}

function unauthorizedResponse(): Response {
  return Response.json(
    { message: "Authentication required" },
    {
      status: 401,
      headers: noStoreHeaders,
    },
  );
}
