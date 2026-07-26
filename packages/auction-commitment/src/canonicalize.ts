import {
  COMMITMENT_PROTOCOL_DOMAIN,
  COMMITMENT_PROTOCOL_VERSION,
} from "./constants";
import type { BidCommitmentPayloadV1 } from "./types";
import {
  normalizeCurrency,
  normalizeUuid,
  validateAmountCents,
  validateSecret,
} from "./validation";

export function canonicalizeBidCommitmentV1(
  payload: BidCommitmentPayloadV1,
): string {
  const auctionId = normalizeUuid(payload.auctionId, "Auction ID");
  const bidderId = normalizeUuid(payload.bidderId, "Bidder ID");
  const currency = normalizeCurrency(payload.currency);
  const amountCents = validateAmountCents(payload.amountCents);
  const secret = validateSecret(payload.secret);

  return JSON.stringify([
    COMMITMENT_PROTOCOL_DOMAIN,
    COMMITMENT_PROTOCOL_VERSION,
    auctionId,
    bidderId,
    currency,
    amountCents,
    secret,
  ]);
}
