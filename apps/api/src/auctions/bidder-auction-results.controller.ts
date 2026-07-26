import { Controller, Get, Header, Param, ParseUUIDPipe } from "@nestjs/common";

import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { Roles } from "../auth/decorators/roles.decorator";
import { UserRole } from "../generated/prisma/enums";
import type { PublicUser } from "../users/types/public-user.type";
import { AuctionResultsService } from "./auction-results.service";

@Roles(UserRole.BIDDER)
@Controller("auctions/:auctionId")
export class BidderAuctionResultsController {
  constructor(private readonly auctionResultsService: AuctionResultsService) {}

  @Get("results")
  @Header("Cache-Control", "no-store")
  getBidderResult(
    @CurrentUser() user: PublicUser,
    @Param("auctionId", new ParseUUIDPipe({ version: "4" })) auctionId: string,
  ) {
    return this.auctionResultsService.getBidderResult(user.id, auctionId);
  }
}
