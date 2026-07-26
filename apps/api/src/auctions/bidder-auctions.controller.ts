import {
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Query,
} from "@nestjs/common";

import { Roles } from "../auth/decorators/roles.decorator";
import { UserRole } from "../generated/prisma/enums";
import { BidderAuctionsService } from "./bidder-auctions.service";
import { ListBidderAuctionsQueryDto } from "./dto/list-bidder-auctions-query.dto";

@Roles(UserRole.BIDDER)
@Controller("auctions")
export class BidderAuctionsController {
  constructor(private readonly bidderAuctionsService: BidderAuctionsService) {}

  @Get()
  @Header("Cache-Control", "no-store")
  listVisibleAuctions(@Query() query: ListBidderAuctionsQueryDto) {
    return this.bidderAuctionsService.listVisibleAuctions(query);
  }

  @Get(":auctionId")
  @Header("Cache-Control", "no-store")
  getVisibleAuctionById(
    @Param("auctionId", new ParseUUIDPipe({ version: "4" })) auctionId: string,
  ) {
    return this.bidderAuctionsService.getVisibleAuctionById(auctionId);
  }
}
