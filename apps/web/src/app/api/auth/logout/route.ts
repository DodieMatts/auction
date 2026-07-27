import { assertSameOriginRequest } from "@/lib/auth/same-origin-request";
import { deleteSessionToken } from "@/lib/auth/session-cookie";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

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

  await deleteSessionToken();

  return new Response(null, {
    status: 204,
    headers: noStoreHeaders,
  });
}
