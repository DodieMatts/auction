import { ApiError } from "@/lib/api/api-error";
import { settleAdminAuction } from "@/lib/admin/admin-auctions-api";
import { normalizeSettleAuctionRequest } from "@/lib/admin/admin-auction-validation";
import { assertSameOriginRequest } from "@/lib/auth/same-origin-request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const noStoreHeaders = { "Cache-Control": "no-store", Pragma: "no-cache", Vary: "Cookie" };
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const maxBodyBytes = 8192;

export async function POST(
  request: Request,
  context: { params: Promise<{ auctionId: string }> },
): Promise<Response> {
  const originFailure = assertSameOriginRequest(request);
  if (originFailure) return originFailure;
  const { auctionId } = await context.params;
  if (!uuidPattern.test(auctionId)) return jsonResponse({ message: "Auction not found" }, 404);
  const body = await readBody(request);
  if (!body) return jsonResponse({ message: "Invalid auction request" }, 400);
  try {
    return jsonResponse(await settleAdminAuction(auctionId, normalizeSettleAuctionRequest(body)), 200);
  } catch (error) {
    return errorResponse(error);
  }
}

async function readBody(request: Request) {
  if (!(request.headers.get("content-type") ?? "").includes("application/json")) return null;
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > maxBodyBytes) return null;
  try {
    const value = JSON.parse(text) as unknown;
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function errorResponse(error: unknown): Response {
  if (error instanceof ApiError) return jsonResponse({ message: error.message }, error.status);
  return jsonResponse({ message: "Invalid auction request" }, 400);
}

function jsonResponse(body: unknown, status: number): Response {
  return Response.json(body, { status, headers: noStoreHeaders });
}
