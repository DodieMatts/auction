import { ApiError } from "@/lib/api/api-error";
import {
  createAdminAuction,
  listAdminAuctions,
} from "@/lib/admin/admin-auctions-api";
import type { AuctionStatus } from "@/lib/admin/admin-auction-types";
import { normalizeCreateAuctionRequest } from "@/lib/admin/admin-auction-validation";
import { assertSameOriginRequest } from "@/lib/auth/same-origin-request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const noStoreHeaders = {
  "Cache-Control": "no-store",
  Pragma: "no-cache",
  Vary: "Cookie",
};
const maxBodyBytes = 8192;
const statuses = new Set<AuctionStatus>([
  "DRAFT",
  "PUBLISHED",
  "CANCELLED",
  "SETTLED",
]);

export async function GET(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const page = parseIntegerQuery(url.searchParams.get("page"), 1, 100000, 1);
    const limit = parseIntegerQuery(url.searchParams.get("limit"), 1, 100, 20);
    const rawStatus = url.searchParams.get("status");
    const status =
      rawStatus && statuses.has(rawStatus as AuctionStatus)
        ? (rawStatus as AuctionStatus)
        : undefined;

    if (Number.isNaN(page) || Number.isNaN(limit) || (rawStatus && !status)) {
      return jsonResponse({ message: "Invalid auction query" }, 400);
    }

    return jsonResponse(await listAdminAuctions({ page, limit, status }), 200);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request): Promise<Response> {
  const originFailure = assertSameOriginRequest(request);
  if (originFailure) return originFailure;

  const parsed = await readJsonObject(request);
  if (!parsed.ok) return jsonResponse({ message: "Invalid auction request" }, 400);

  try {
    const body = normalizeCreateAuctionRequest(parsed.value);
    return jsonResponse(await createAdminAuction(body), 201);
  } catch (error) {
    return errorResponse(error);
  }
}

function parseIntegerQuery(
  value: string | null,
  min: number,
  max: number,
  fallback: number,
): number {
  if (value === null) return fallback;
  if (!/^\d+$/.test(value)) return Number.NaN;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max
    ? parsed
    : Number.NaN;
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
