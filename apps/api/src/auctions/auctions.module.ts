import { Module } from "@nestjs/common";

import { AdminAuctionsController } from "./admin-auctions.controller";
import { AuctionsService } from "./auctions.service";
import { BidderAuctionsController } from "./bidder-auctions.controller";
import { BidderAuctionsService } from "./bidder-auctions.service";

@Module({
  controllers: [AdminAuctionsController, BidderAuctionsController],
  providers: [AuctionsService, BidderAuctionsService],
  exports: [AuctionsService],
})
export class AuctionsModule {}
