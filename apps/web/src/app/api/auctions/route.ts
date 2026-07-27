import { ApiError } from "@/lib/api/api-error";
import { listBidderAuctions } from "@/lib/bidder/bidder-auctions-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const noStoreHeaders = {
  "Cache-Control": "no-store",
  Pragma: "no-cache",
  Vary: "Cookie",
};

export async function GET(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const page = parseIntegerQuery(url.searchParams.get("page"), 1, 100000, 1);
    const limit = parseIntegerQuery(url.searchParams.get("limit"), 1, 100, 20);
    if (Number.isNaN(page) || Number.isNaN(limit) || hasUnknownQuery(url.searchParams)) {
      return jsonResponse({ message: "Invalid auction query" }, 400);
    }
    return jsonResponse(await listBidderAuctions({ page, limit }), 200);
  } catch (error) {
    return errorResponse(error);
  }
}

function parseIntegerQuery(value: string | null, min: number, max: number, fallback: number) {
  if (value === null) return fallback;
  if (!/^\d+$/.test(value)) return Number.NaN;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : Number.NaN;
}

function hasUnknownQuery(params: URLSearchParams): boolean {
  return [...params.keys()].some((key) => key !== "page" && key !== "limit");
}

function errorResponse(error: unknown): Response {
  if (error instanceof ApiError) {
    return jsonResponse({ message: safeMessage(error.status, error.message) }, error.status);
  }
  return jsonResponse({ message: "Auction service is unavailable" }, 503);
}

function safeMessage(status: number, message: string): string {
  if (status === 401) return "Authentication required";
  if (status === 403) return "Bidder access required";
  if (status === 503) return "Auction service is unavailable";
  return message;
}

function jsonResponse(body: unknown, status: number): Response {
  return Response.json(body, { status, headers: noStoreHeaders });
}
