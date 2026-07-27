import type {
  AdminAuction,
  AdminAuctionDetailResponse,
  AdminAuctionListResponse,
  AdminAuctionResultResponse,
  AdminAuctionSettlementResponse,
  AuctionPhase,
  AuctionStatus,
  CancelAuctionRequest,
  CreateAuctionRequest,
  PublishAuctionRequest,
  SettleAuctionRequest,
  UpdateAuctionRequest,
} from "./admin-auction-types";

export const invalidAuctionServiceDataMessage =
  "Auction service returned invalid data";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isoDatePattern =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const statuses = new Set<AuctionStatus>([
  "DRAFT",
  "PUBLISHED",
  "CANCELLED",
  "SETTLED",
]);
const phases = new Set<AuctionPhase>([
  "DRAFT",
  "SCHEDULED",
  "COMMIT",
  "REVEAL",
  "ENDED",
  "CANCELLED",
  "SETTLED",
]);

export function validateAdminAuctionListResponse(
  value: unknown,
): AdminAuctionListResponse {
  if (!isRecord(value)) throwInvalid();
  const data = Array.isArray(value.data)
    ? value.data.map(parseAdminAuction)
    : null;
  const pagination = isRecord(value.pagination)
    ? {
        page: parsePositiveInteger(value.pagination.page),
        limit: parsePositiveInteger(value.pagination.limit),
        total: parseNonnegativeInteger(value.pagination.total),
        totalPages: parseNonnegativeInteger(value.pagination.totalPages),
      }
    : null;

  if (!data || !pagination || !isIsoDate(value.serverTime)) throwInvalid();

  return {
    data,
    pagination,
    serverTime: value.serverTime,
  };
}

export function validateAdminAuctionDetailResponse(
  value: unknown,
): AdminAuctionDetailResponse {
  if (!isRecord(value) || !isIsoDate(value.serverTime)) throwInvalid();
  return {
    auction: parseAdminAuction(value.auction),
    serverTime: value.serverTime,
  };
}

export function validateAdminAuctionSettlementResponse(
  value: unknown,
): AdminAuctionSettlementResponse {
  if (!isRecord(value) || !isRecord(value.auction) || !isIsoDate(value.serverTime)) {
    throwInvalid();
  }

  return {
    auction: {
      id: parseUuid(value.auction.id),
      status: parseStatus(value.auction.status),
      phase: parsePhase(value.auction.phase),
      version: parseNonnegativeInteger(value.auction.version),
      settledAt: parseIsoDate(value.auction.settledAt),
    },
    summary: parseSettlementSummary(value.summary),
    serverTime: value.serverTime,
  };
}

export function validateAdminAuctionResultResponse(
  value: unknown,
): AdminAuctionResultResponse {
  if (!isRecord(value) || !isRecord(value.auction) || !isIsoDate(value.serverTime)) {
    throwInvalid();
  }

  return {
    auction: {
      id: parseUuid(value.auction.id),
      title: parseString(value.auction.title),
      currency: parseCurrency(value.auction.currency),
      status: parseStatus(value.auction.status),
      phase: parsePhase(value.auction.phase),
      settledAt: parseIsoDate(value.auction.settledAt),
      version: parseNonnegativeInteger(value.auction.version),
    },
    summary: parseAdminResultSummary(value.summary),
    serverTime: value.serverTime,
  };
}

export function normalizeCreateAuctionRequest(
  value: Record<string, unknown>,
): CreateAuctionRequest {
  assertOnlyKeys(value, [
    "creationRequestId",
    "title",
    "description",
    "currency",
    "startTime",
    "revealTime",
    "endTime",
  ]);

  return {
    creationRequestId: parseUuid(value.creationRequestId),
    title: parseBoundedString(value.title, 1, 200),
    description:
      value.description === undefined || value.description === null
        ? null
        : parseBoundedString(value.description, 0, 5000),
    currency: parseCurrency(value.currency),
    startTime: parseIsoDate(value.startTime),
    revealTime: parseIsoDate(value.revealTime),
    endTime: parseIsoDate(value.endTime),
  };
}

export function normalizeUpdateAuctionRequest(
  value: Record<string, unknown>,
): UpdateAuctionRequest {
  assertOnlyKeys(value, [
    "expectedVersion",
    "title",
    "description",
    "currency",
    "startTime",
    "revealTime",
    "endTime",
  ]);
  const request: UpdateAuctionRequest = {
    expectedVersion: parseNonnegativeInteger(value.expectedVersion),
  };

  if (value.title !== undefined) request.title = parseBoundedString(value.title, 1, 200);
  if (value.description !== undefined) {
    request.description =
      value.description === null
        ? null
        : parseBoundedString(value.description, 0, 5000);
  }
  if (value.currency !== undefined) request.currency = parseCurrency(value.currency);
  if (value.startTime !== undefined) request.startTime = parseIsoDate(value.startTime);
  if (value.revealTime !== undefined) request.revealTime = parseIsoDate(value.revealTime);
  if (value.endTime !== undefined) request.endTime = parseIsoDate(value.endTime);

  if (Object.keys(request).length === 1) {
    throw new Error("At least one editable field is required");
  }

  return request;
}

export function normalizePublishAuctionRequest(
  value: Record<string, unknown>,
): PublishAuctionRequest {
  assertOnlyKeys(value, ["expectedVersion"]);
  return { expectedVersion: parseNonnegativeInteger(value.expectedVersion) };
}

export function normalizeCancelAuctionRequest(
  value: Record<string, unknown>,
): CancelAuctionRequest {
  assertOnlyKeys(value, ["cancellationRequestId", "expectedVersion", "reason"]);
  return {
    cancellationRequestId: parseUuid(value.cancellationRequestId),
    expectedVersion: parseNonnegativeInteger(value.expectedVersion),
    reason: parseBoundedString(value.reason, 1, 500),
  };
}

export function normalizeSettleAuctionRequest(
  value: Record<string, unknown>,
): SettleAuctionRequest {
  assertOnlyKeys(value, ["settlementRequestId", "expectedVersion"]);
  return {
    settlementRequestId: parseUuid(value.settlementRequestId),
    expectedVersion: parseNonnegativeInteger(value.expectedVersion),
  };
}

function parseAdminAuction(value: unknown): AdminAuction {
  if (!isRecord(value)) throwInvalid();
  return {
    id: parseUuid(value.id),
    title: parseString(value.title),
    description: parseNullableString(value.description),
    currency: parseCurrency(value.currency),
    startTime: parseIsoDate(value.startTime),
    revealTime: parseIsoDate(value.revealTime),
    endTime: parseIsoDate(value.endTime),
    status: parseStatus(value.status),
    phase: parsePhase(value.phase),
    createdById: parseUuid(value.createdById),
    version: parseNonnegativeInteger(value.version),
    settledAt: parseNullableIsoDate(value.settledAt),
    cancelledAt: parseNullableIsoDate(value.cancelledAt),
    cancellationReason: parseNullableString(value.cancellationReason),
    createdAt: parseIsoDate(value.createdAt),
    updatedAt: parseIsoDate(value.updatedAt),
  };
}

function parseSettlementSummary(value: unknown) {
  if (!isRecord(value)) throwInvalid();
  return {
    totalBidCount: parseNonnegativeInteger(value.totalBidCount),
    validRevealCount: parseNonnegativeInteger(value.validRevealCount),
    invalidBidCount: parseNonnegativeInteger(value.invalidBidCount),
    winner:
      value.winner === null
        ? null
        : (() => {
            if (!isRecord(value.winner)) throwInvalid();
            return {
              bidId: parseUuid(value.winner.bidId),
              bidderId: parseUuid(value.winner.bidderId),
              amountCents: parseMoney(value.winner.amountCents),
            };
          })(),
  };
}

function parseAdminResultSummary(value: unknown) {
  if (!isRecord(value)) throwInvalid();
  return {
    totalBidCount: parseNonnegativeInteger(value.totalBidCount),
    validRevealCount: parseNonnegativeInteger(value.validRevealCount),
    invalidBidCount: parseNonnegativeInteger(value.invalidBidCount),
    winner:
      value.winner === null
        ? null
        : (() => {
            if (!isRecord(value.winner) || !isRecord(value.winner.bidder)) throwInvalid();
            return {
              bidder: {
                id: parseUuid(value.winner.bidder.id),
                email: parseString(value.winner.bidder.email),
              },
              amountCents: parseMoney(value.winner.amountCents),
            };
          })(),
  };
}

function parseString(value: unknown): string {
  if (typeof value !== "string") throwInvalid();
  return value;
}

function parseBoundedString(value: unknown, min: number, max: number): string {
  const stringValue = parseString(value).trim();
  if (stringValue.length < min || stringValue.length > max) {
    throw new Error("Invalid auction request");
  }
  return stringValue;
}

function parseNullableString(value: unknown): string | null {
  return value === null ? null : parseString(value);
}

function parseUuid(value: unknown): string {
  const stringValue = parseString(value);
  if (!uuidPattern.test(stringValue)) throwInvalid();
  return stringValue;
}

function parseIsoDate(value: unknown): string {
  const stringValue = parseString(value);
  if (!isIsoDate(stringValue)) throwInvalid();
  return stringValue;
}

function parseNullableIsoDate(value: unknown): string | null {
  return value === null ? null : parseIsoDate(value);
}

function isIsoDate(value: unknown): value is string {
  return (
    typeof value === "string" &&
    isoDatePattern.test(value) &&
    !Number.isNaN(Date.parse(value))
  );
}

function parseStatus(value: unknown): AuctionStatus {
  if (typeof value !== "string" || !statuses.has(value as AuctionStatus)) {
    throwInvalid();
  }
  return value as AuctionStatus;
}

function parsePhase(value: unknown): AuctionPhase {
  if (typeof value !== "string" || !phases.has(value as AuctionPhase)) {
    throwInvalid();
  }
  return value as AuctionPhase;
}

function parseCurrency(value: unknown): string {
  const stringValue = parseString(value).trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(stringValue)) throwInvalid();
  return stringValue;
}

function parseMoney(value: unknown): string {
  const stringValue = parseString(value);
  if (!/^(0|[1-9]\d*)$/.test(stringValue)) throwInvalid();
  return stringValue;
}

function parseNonnegativeInteger(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) throwInvalid();
  return value;
}

function parsePositiveInteger(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) throwInvalid();
  return value;
}

function assertOnlyKeys(value: Record<string, unknown>, allowedKeys: string[]) {
  const allowed = new Set(allowedKeys);
  if (!Object.keys(value).every((key) => allowed.has(key))) {
    throw new Error("Invalid auction request");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function throwInvalid(): never {
  throw new Error(invalidAuctionServiceDataMessage);
}
