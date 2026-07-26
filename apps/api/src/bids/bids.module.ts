import { Module } from "@nestjs/common";

import { BidCommitmentsController } from "./bid-commitments.controller";
import { BidCommitmentsService } from "./bid-commitments.service";

@Module({
  controllers: [BidCommitmentsController],
  providers: [BidCommitmentsService],
  exports: [BidCommitmentsService],
})
export class BidsModule {}
