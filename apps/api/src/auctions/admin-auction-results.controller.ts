import { Controller, Get, Header, Param, ParseUUIDPipe } from "@nestjs/common";

import { Roles } from "../auth/decorators/roles.decorator";
import { UserRole } from "../generated/prisma/enums";
import { AuctionResultsService } from "./auction-results.service";

@Roles(UserRole.ADMIN)
@Controller("admin/auctions/:auctionId")
export class AdminAuctionResultsController {
  constructor(private readonly auctionResultsService: AuctionResultsService) {}

  @Get("results")
  @Header("Cache-Control", "no-store")
  getAdminResult(
    @Param("auctionId", new ParseUUIDPipe({ version: "4" })) auctionId: string,
  ) {
    return this.auctionResultsService.getAdminResult(auctionId);
  }
}
