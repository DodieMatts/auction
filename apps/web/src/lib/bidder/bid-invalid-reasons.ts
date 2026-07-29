import type { BidInvalidReason } from "./bidder-auction-types";

export function getBidInvalidReasonMessage(reason: BidInvalidReason | string | null): string | null {
  switch (reason) {
    case "NOT_REVEALED":
      return "This bid was marked invalid because it was not revealed before the reveal period ended.";
    case "COMMITMENT_MISMATCH":
      return "This bid was marked invalid because the submitted receipt did not match the latest commitment.";
    case "REPLACED_RECEIPT":
      return "This receipt is from a bid that was replaced. Use the newest receipt for the active bid.";
    case "REVEAL_NOT_ACCEPTED":
      return "Reveal can only be submitted during the reveal period.";
    case null:
      return null;
    default:
      return null;
  }
}

export function getRevealSubmissionMessage(status: number, message: string): string {
  if (status === 422) {
    return getBidInvalidReasonMessage("COMMITMENT_MISMATCH") ?? message;
  }

  if (status === 409 && message === "Auction is not accepting reveals") {
    return getBidInvalidReasonMessage("REVEAL_NOT_ACCEPTED") ?? message;
  }

  if (status === 409) {
    return "Your bid state changed. Refresh before retrying.";
  }

  if (status === 503) {
    return "Auction service is unavailable.";
  }

  return message;
}
