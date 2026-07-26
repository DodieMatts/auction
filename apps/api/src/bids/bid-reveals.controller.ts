import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Post,
} from "@nestjs/common";

import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { Roles } from "../auth/decorators/roles.decorator";
import { UserRole } from "../generated/prisma/enums";
import type { PublicUser } from "../users/types/public-user.type";
import { BidRevealsService } from "./bid-reveals.service";
import { SubmitBidRevealDto } from "./dto/submit-bid-reveal.dto";

@Roles(UserRole.BIDDER)
@Controller("auctions/:auctionId")
export class BidRevealsController {
  constructor(private readonly bidRevealsService: BidRevealsService) {}

  @Post("reveals")
  @Header("Cache-Control", "no-store")
  submitReveal(
    @CurrentUser() user: PublicUser,
    @Param("auctionId", new ParseUUIDPipe({ version: "4" })) auctionId: string,
    @Body() dto: SubmitBidRevealDto,
  ) {
    return this.bidRevealsService.submitReveal(user.id, auctionId, dto);
  }

  @Get("reveal-status")
  @Header("Cache-Control", "no-store")
  getRevealStatus(
    @CurrentUser() user: PublicUser,
    @Param("auctionId", new ParseUUIDPipe({ version: "4" })) auctionId: string,
  ) {
    return this.bidRevealsService.getRevealStatus(user.id, auctionId);
  }
}
