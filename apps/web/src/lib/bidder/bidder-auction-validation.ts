import type {
  AuctionPhase,
  AuctionStatus,
  BidCommitmentResponse,
  BidInvalidReason,
  BidParticipationResponse,
  BidRevealResponse,
  BidRevealStatusResponse,
  BidStatus,
  BidderAuction,
  BidderAuctionDetailResponse,
  BidderAuctionListResponse,
  BidderAuctionOutcome,
  BidderAuctionResultResponse,
  RevealValidationStatus,
  SubmitCommitmentRequest,
  SubmitRevealRequest,
} from "./bidder-auction-types";

export const invalidAuctionServiceDataMessage = "Auction service returned invalid data";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isoDatePattern =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const moneyPattern = /^[1-9]\d*$/;
const maxPostgresBigInt = BigInt("9223372036854775807");
const hashPattern = /^[0-9a-f]{64}$/;
const secretPattern = /^[A-Za-z0-9_-]{43}$/;
const statuses = new Set<AuctionStatus>(["PUBLISHED", "SETTLED"]);
const phases = new Set<AuctionPhase>(["SCHEDULED", "COMMIT", "REVEAL", "ENDED", "SETTLED"]);
const bidStatuses = new Set<BidStatus>(["COMMITTED", "REVEALED", "INVALID", "WON", "LOST"]);
const validationStatuses = new Set<RevealValidationStatus>(["PENDING", "VALID", "INVALID"]);
const outcomes = new Set<BidderAuctionOutcome>(["NOT_PARTICIPATED", "WON", "LOST", "INVALID"]);
const invalidReasons = new Set<BidInvalidReason>([
  "NOT_REVEALED",
  "COMMITMENT_MISMATCH",
  "REPLACED_RECEIPT",
  "REVEAL_NOT_ACCEPTED",
]);

export function validateBidderAuctionListResponse(value: unknown): BidderAuctionListResponse {
  if (!isRecord(value) || !isIsoDate(value.serverTime) || !isRecord(value.pagination)) {
    throwInvalid();
  }
  return {
    data: Array.isArray(value.data) ? value.data.map(parseAuction) : throwInvalid(),
    pagination: {
      page: parsePositiveInteger(value.pagination.page),
      limit: parsePositiveInteger(value.pagination.limit),
      total: parseNonnegativeInteger(value.pagination.total),
      totalPages: parseNonnegativeInteger(value.pagination.totalPages),
    },
    serverTime: value.serverTime,
  };
}

export function validateBidderAuctionDetailResponse(value: unknown): BidderAuctionDetailResponse {
  if (!isRecord(value) || !isIsoDate(value.serverTime)) throwInvalid();
  return { auction: parseAuction(value.auction), serverTime: value.serverTime };
}

export function validateBidParticipationResponse(value: unknown): BidParticipationResponse {
  if (!isRecord(value) || !isIsoDate(value.serverTime)) throwInvalid();
  return {
    auctionId: parseUuid(value.auctionId),
    phase: parsePhase(value.phase),
    canCommit: parseBoolean(value.canCommit),
    participation:
      value.participation === null
        ? null
        : parseParticipation(value.participation),
    serverTime: value.serverTime,
  };
}

export function validateBidCommitmentResponse(value: unknown): BidCommitmentResponse {
  if (!isRecord(value) || !isRecord(value.bid) || !isRecord(value.commitment) || !isIsoDate(value.serverTime)) {
    throwInvalid();
  }
  return {
    auctionId: parseUuid(value.auctionId),
    phase: parsePhase(value.phase),
    bid: {
      id: parseUuid(value.bid.id),
      status: parseBidStatus(value.bid.status),
      version: parseNonnegativeInteger(value.bid.version),
    },
    commitment: parseCommitment(value.commitment),
    replacedPreviousCommitment: parseBoolean(value.replacedPreviousCommitment),
    serverTime: value.serverTime,
  };
}

export function validateBidRevealStatusResponse(value: unknown): BidRevealStatusResponse {
  if (!isRecord(value) || !isIsoDate(value.serverTime)) throwInvalid();
  return {
    auctionId: parseUuid(value.auctionId),
    phase: parsePhase(value.phase),
    canReveal: parseBoolean(value.canReveal),
    bid:
      value.bid === null
        ? null
        : parseRevealStatusBid(value.bid),
    validReveal:
      value.validReveal === null
        ? null
        : parseValidReveal(value.validReveal),
    invalidAttemptCount: parseNonnegativeInteger(value.invalidAttemptCount),
    serverTime: value.serverTime,
  };
}

export function validateBidRevealResponse(value: unknown): BidRevealResponse {
  if (!isRecord(value) || !isRecord(value.bid) || !isRecord(value.reveal) || !isIsoDate(value.serverTime)) {
    throwInvalid();
  }
  return {
    auctionId: parseUuid(value.auctionId),
    phase: parsePhase(value.phase),
    bid: {
      id: parseUuid(value.bid.id),
      status: parseBidStatus(value.bid.status),
      version: parseNonnegativeInteger(value.bid.version),
    },
    reveal: {
      id: parseUuid(value.reveal.id),
      validationStatus: parseRevealValidationStatus(value.reveal.validationStatus),
      amountCents: parseMoney(value.reveal.amountCents),
      submittedAt: parseIsoDate(value.reveal.submittedAt),
    },
    serverTime: value.serverTime,
  };
}

export function validateBidderAuctionResultResponse(value: unknown): BidderAuctionResultResponse {
  if (!isRecord(value) || !isRecord(value.auction) || !isRecord(value.result) || !isIsoDate(value.serverTime)) {
    throwInvalid();
  }
  const auction = parseAuction(value.auction);
  if (auction.status !== "SETTLED" || auction.phase !== "SETTLED") throwInvalid();
  return {
    auction: {
      ...auction,
      status: "SETTLED",
      phase: "SETTLED",
      settledAt: parseIsoDate(value.auction.settledAt),
    },
    result: {
      winner:
        value.result.winner === null
          ? null
          : parseResultWinner(value.result.winner),
      totalBidCount: parseNonnegativeInteger(value.result.totalBidCount),
      validRevealCount: parseNonnegativeInteger(value.result.validRevealCount),
      invalidBidCount: parseNonnegativeInteger(value.result.invalidBidCount),
      yourOutcome: parseYourOutcome(value.result.yourOutcome),
    },
    serverTime: value.serverTime,
  };
}

export function normalizeSubmitCommitmentRequest(
  value: Record<string, unknown>,
): SubmitCommitmentRequest {
  assertOnlyKeys(value, [
    "clientRequestId",
    "commitmentHash",
    "protocolVersion",
    "expectedBidVersion",
  ]);
  const request: SubmitCommitmentRequest = {
    clientRequestId: parseUuid(value.clientRequestId),
    commitmentHash: parseHash(value.commitmentHash),
    protocolVersion: parseProtocolVersion(value.protocolVersion),
  };
  if (value.expectedBidVersion !== undefined) {
    request.expectedBidVersion = parseNonnegativeInteger(value.expectedBidVersion);
  }
  return request;
}

export function normalizeSubmitRevealRequest(value: Record<string, unknown>): SubmitRevealRequest {
  assertOnlyKeys(value, ["clientRequestId", "amountCents", "secret", "expectedBidVersion"]);
  return {
    clientRequestId: parseUuid(value.clientRequestId),
    amountCents: parseMoney(value.amountCents),
    secret: parseSecret(value.secret),
    expectedBidVersion: parseNonnegativeInteger(value.expectedBidVersion),
  };
}

function parseAuction(value: unknown): BidderAuction {
  if (!isRecord(value)) throwInvalid();
  return {
    id: parseUuid(value.id),
    title: parseString(value.title),
    description: value.description === null ? null : parseString(value.description),
    currency: parseCurrency(value.currency),
    startTime: parseIsoDate(value.startTime),
    revealTime: parseIsoDate(value.revealTime),
    endTime: parseIsoDate(value.endTime),
    status: parseStatus(value.status),
    phase: parsePhase(value.phase),
  };
}

function parseParticipation(value: unknown) {
  if (!isRecord(value)) throwInvalid();
  return {
    bidId: parseUuid(value.bidId),
    status: parseBidStatus(value.status),
    version: parseNonnegativeInteger(value.version),
    currentCommitment: parseCommitment(value.currentCommitment),
    invalidReason: value.invalidReason === null ? null : parseInvalidReason(value.invalidReason),
  };
}

function parseCommitment(value: unknown) {
  if (!isRecord(value)) throwInvalid();
  if ("commitmentHash" in value) {
    parseHash(value.commitmentHash);
  }
  return {
    id: parseUuid(value.id),
    protocolVersion: parseProtocolVersion(value.protocolVersion),
    committedAt: parseIsoDate(value.committedAt),
  };
}

function parseRevealStatusBid(value: unknown) {
  if (!isRecord(value)) throwInvalid();
  return {
    id: parseUuid(value.id),
    status: parseBidStatus(value.status),
    version: parseNonnegativeInteger(value.version),
  };
}

function parseValidReveal(value: unknown) {
  if (!isRecord(value)) throwInvalid();
  return {
    id: parseUuid(value.id),
    amountCents: parseMoney(value.amountCents),
    submittedAt: parseIsoDate(value.submittedAt),
  };
}

function parseResultWinner(value: unknown) {
  if (!isRecord(value)) throwInvalid();
  return { amountCents: parseMoney(value.amountCents) };
}

function parseYourOutcome(value: unknown) {
  if (!isRecord(value)) throwInvalid();
  const status = parseOutcome(value.status);
  return {
    status,
    amountCents: value.amountCents === null ? null : parseMoney(value.amountCents),
    invalidReason: value.invalidReason === null ? null : parseInvalidReason(value.invalidReason),
  };
}

function parseUuid(value: unknown): string {
  if (typeof value !== "string" || !uuidPattern.test(value)) throwInvalid();
  return value.toLowerCase();
}

function parseString(value: unknown): string {
  if (typeof value !== "string") throwInvalid();
  return value;
}

function parseCurrency(value: unknown): string {
  const stringValue = parseString(value).trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(stringValue)) throwInvalid();
  return stringValue;
}

function parseIsoDate(value: unknown): string {
  if (!isIsoDate(value)) throwInvalid();
  return value;
}

function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && isoDatePattern.test(value) && !Number.isNaN(Date.parse(value));
}

function parseStatus(value: unknown): AuctionStatus {
  if (typeof value !== "string" || !statuses.has(value as AuctionStatus)) throwInvalid();
  return value as AuctionStatus;
}

function parsePhase(value: unknown): AuctionPhase {
  if (typeof value !== "string" || !phases.has(value as AuctionPhase)) throwInvalid();
  return value as AuctionPhase;
}

function parseBidStatus(value: unknown): BidStatus {
  if (typeof value !== "string" || !bidStatuses.has(value as BidStatus)) throwInvalid();
  return value as BidStatus;
}

function parseRevealValidationStatus(value: unknown): RevealValidationStatus {
  if (typeof value !== "string" || !validationStatuses.has(value as RevealValidationStatus)) {
    throwInvalid();
  }
  return value as RevealValidationStatus;
}

function parseOutcome(value: unknown): BidderAuctionOutcome {
  if (typeof value !== "string" || !outcomes.has(value as BidderAuctionOutcome)) throwInvalid();
  return value as BidderAuctionOutcome;
}

function parseInvalidReason(value: unknown): BidInvalidReason {
  if (typeof value !== "string" || !invalidReasons.has(value as BidInvalidReason)) {
    throwInvalid();
  }
  return value as BidInvalidReason;
}

function parseMoney(value: unknown): string {
  if (typeof value !== "string" || !moneyPattern.test(value)) throwInvalid();
  if (BigInt(value) > maxPostgresBigInt) throwInvalid();
  return value;
}

function parseHash(value: unknown): string {
  if (typeof value !== "string" || !hashPattern.test(value)) throwInvalid();
  return value;
}

function parseSecret(value: unknown): string {
  if (typeof value !== "string" || !secretPattern.test(value)) throwInvalid();
  return value;
}

function parseProtocolVersion(value: unknown): 1 {
  if (typeof value !== "number" || !Number.isInteger(value) || value !== 1) throwInvalid();
  return 1;
}

function parseBoolean(value: unknown): boolean {
  if (typeof value !== "boolean") throwInvalid();
  return value;
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
