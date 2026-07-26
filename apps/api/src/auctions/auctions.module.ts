import { Module } from "@nestjs/common";

import { AdminAuctionSettlementController } from "./admin-auction-settlement.controller";
import { AdminAuctionResultsController } from "./admin-auction-results.controller";
import { AdminAuctionsController } from "./admin-auctions.controller";
import { AuctionResultsService } from "./auction-results.service";
import { AuctionSettlementService } from "./auction-settlement.service";
import { AuctionsService } from "./auctions.service";
import { BidderAuctionResultsController } from "./bidder-auction-results.controller";
import { BidderAuctionsController } from "./bidder-auctions.controller";
import { BidderAuctionsService } from "./bidder-auctions.service";

@Module({
  controllers: [
    AdminAuctionsController,
    AdminAuctionSettlementController,
    AdminAuctionResultsController,
    BidderAuctionsController,
    BidderAuctionResultsController,
  ],
  providers: [
    AuctionsService,
    AuctionSettlementService,
    AuctionResultsService,
    BidderAuctionsService,
  ],
  exports: [AuctionsService, AuctionSettlementService, AuctionResultsService],
})
export class AuctionsModule {}
