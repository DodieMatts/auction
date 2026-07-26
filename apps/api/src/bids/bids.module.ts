import { Module } from "@nestjs/common";

import { BidCommitmentsController } from "./bid-commitments.controller";
import { BidCommitmentsService } from "./bid-commitments.service";
import { BidRevealsController } from "./bid-reveals.controller";
import { BidRevealsService } from "./bid-reveals.service";

@Module({
  controllers: [BidCommitmentsController, BidRevealsController],
  providers: [BidCommitmentsService, BidRevealsService],
  exports: [BidCommitmentsService, BidRevealsService],
})
export class BidsModule {}
