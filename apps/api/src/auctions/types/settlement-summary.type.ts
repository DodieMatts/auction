export type SettlementSummary = {
  totalBidCount: number;
  validRevealCount: number;
  invalidBidCount: number;
  winner: {
    bidId: string;
    bidderId: string;
    amountCents: string;
  } | null;
};
