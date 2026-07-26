export interface BidCommitmentPayloadV1 {
  auctionId: string;
  bidderId: string;
  currency: string;
  amountCents: string;
  secret: string;
}
