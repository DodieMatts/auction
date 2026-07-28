import { ApiError } from "@/lib/api/api-error";
import { getBidderAuction } from "@/lib/bidder/bidder-auctions-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const noStoreHeaders = { "Cache-Control": "no-store", Pragma: "no-cache", Vary: "Cookie" };
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(
  _request: Request,
  context: { params: Promise<{ auctionId: string }> },
): Promise<Response> {
  const { auctionId } = await context.params;
  if (!uuidPattern.test(auctionId)) return jsonResponse({ message: "Auction not found" }, 404);
  try {
    return jsonResponse(await getBidderAuction(auctionId), 200);
  } catch (error) {
    return errorResponse(error);
  }
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
  if (status === 404) return "Auction not found";
  if (status === 503) return "Auction service is unavailable";
  return message;
}

function jsonResponse(body: unknown, status: number): Response {
  return Response.json(body, { status, headers: noStoreHeaders });
}
