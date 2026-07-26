import {
  Body,
  Controller,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from "@nestjs/common";

import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { Roles } from "../auth/decorators/roles.decorator";
import { UserRole } from "../generated/prisma/enums";
import type { PublicUser } from "../users/types/public-user.type";
import { AuctionSettlementService } from "./auction-settlement.service";
import { SettleAuctionDto } from "./dto/settle-auction.dto";

@Roles(UserRole.ADMIN)
@Controller("admin/auctions/:auctionId")
export class AdminAuctionSettlementController {
  constructor(private readonly auctionSettlementService: AuctionSettlementService) {}

  @Post("settle")
  @Header("Cache-Control", "no-store")
  @HttpCode(HttpStatus.OK)
  settleAuction(
    @CurrentUser() user: PublicUser,
    @Param("auctionId", new ParseUUIDPipe({ version: "4" })) auctionId: string,
    @Body() dto: SettleAuctionDto,
  ) {
    return this.auctionSettlementService.settleAuction(user.id, auctionId, dto);
  }
}
