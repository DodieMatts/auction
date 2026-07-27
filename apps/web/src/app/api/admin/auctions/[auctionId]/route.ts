import { ApiError } from "@/lib/api/api-error";
import {
  getAdminAuction,
  updateAdminAuction,
} from "@/lib/admin/admin-auctions-api";
import { normalizeUpdateAuctionRequest } from "@/lib/admin/admin-auction-validation";
import { assertSameOriginRequest } from "@/lib/auth/same-origin-request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const noStoreHeaders = {
  "Cache-Control": "no-store",
  Pragma: "no-cache",
  Vary: "Cookie",
};
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const maxBodyBytes = 8192;

export async function GET(
  _request: Request,
  context: { params: Promise<{ auctionId: string }> },
): Promise<Response> {
  const { auctionId } = await context.params;
  if (!uuidPattern.test(auctionId)) {
    return jsonResponse({ message: "Auction not found" }, 404);
  }

  try {
    return jsonResponse(await getAdminAuction(auctionId), 200);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ auctionId: string }> },
): Promise<Response> {
  const originFailure = assertSameOriginRequest(request);
  if (originFailure) return originFailure;

  const { auctionId } = await context.params;
  if (!uuidPattern.test(auctionId)) {
    return jsonResponse({ message: "Auction not found" }, 404);
  }

  const parsed = await readJsonObject(request);
  if (!parsed.ok) return jsonResponse({ message: "Invalid auction request" }, 400);

  try {
    const body = normalizeUpdateAuctionRequest(parsed.value);
    return jsonResponse(await updateAdminAuction(auctionId, body), 200);
  } catch (error) {
    return errorResponse(error);
  }
}

async function readJsonObject(
  request: Request,
): Promise<{ ok: true; value: Record<string, unknown> } | { ok: false }> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) return { ok: false };
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > maxBodyBytes) return { ok: false };
  try {
    const value = JSON.parse(text) as unknown;
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      return { ok: true, value: value as Record<string, unknown> };
    }
  } catch {
    return { ok: false };
  }
  return { ok: false };
}

function errorResponse(error: unknown): Response {
  if (error instanceof ApiError) {
    return jsonResponse({ message: safeMessage(error.status, error.message) }, error.status);
  }
  return jsonResponse({ message: "Invalid auction request" }, 400);
}

function safeMessage(status: number, message: string): string {
  if (status === 401) return "Authentication required";
  if (status === 403) return "Administrator access required";
  if (status === 503) return "Auction service is unavailable";
  return message;
}

function jsonResponse(body: unknown, status: number): Response {
  return Response.json(body, { status, headers: noStoreHeaders });
}
