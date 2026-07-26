import type { InvalidBidRevealDetails, BidRevealResponse } from "./bid-reveal-response.type";

export type BidRevealOperationResult =
  | {
      outcome: "VALID";
      response: BidRevealResponse;
    }
  | {
      outcome: "INVALID";
      details: InvalidBidRevealDetails;
    }
  | {
      outcome: "EXISTING_VALID";
      response: BidRevealResponse;
    }
  | {
      outcome: "EXISTING_INVALID";
      details: InvalidBidRevealDetails;
    };
