import { Module } from "@nestjs/common";

import { AdminAuctionSettlementController } from "./admin-auction-settlement.controller";
import { AdminAuctionsController } from "./admin-auctions.controller";
import { AuctionSettlementService } from "./auction-settlement.service";
import { AuctionsService } from "./auctions.service";
import { BidderAuctionsController } from "./bidder-auctions.controller";
import { BidderAuctionsService } from "./bidder-auctions.service";

@Module({
  controllers: [
    AdminAuctionsController,
    AdminAuctionSettlementController,
    BidderAuctionsController,
  ],
  providers: [AuctionsService, AuctionSettlementService, BidderAuctionsService],
  exports: [AuctionsService, AuctionSettlementService],
})
export class AuctionsModule {}
