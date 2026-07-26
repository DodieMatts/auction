import { Module } from "@nestjs/common";

import { AdminAuctionsController } from "./admin-auctions.controller";
import { AuctionsService } from "./auctions.service";

@Module({
  controllers: [AdminAuctionsController],
  providers: [AuctionsService],
  exports: [AuctionsService],
})
export class AuctionsModule {}
