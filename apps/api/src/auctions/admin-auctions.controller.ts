import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from "@nestjs/common";

import { Roles } from "../auth/decorators/roles.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { UserRole } from "../generated/prisma/enums";
import type { PublicUser } from "../users/types/public-user.type";
import { AuctionsService } from "./auctions.service";
import { CancelAuctionDto } from "./dto/cancel-auction.dto";
import { CreateAuctionDto } from "./dto/create-auction.dto";
import { ListAuctionsQueryDto } from "./dto/list-auctions-query.dto";
import { PublishAuctionDto } from "./dto/publish-auction.dto";
import { UpdateAuctionDto } from "./dto/update-auction.dto";

@Roles(UserRole.ADMIN)
@Controller("admin/auctions")
export class AdminAuctionsController {
  constructor(private readonly auctionsService: AuctionsService) {}

  @Post()
  @Header("Cache-Control", "no-store")
  createDraft(@CurrentUser() user: PublicUser, @Body() dto: CreateAuctionDto) {
    return this.auctionsService.createDraft(user.id, dto);
  }

  @Get()
  @Header("Cache-Control", "no-store")
  listAuctions(@Query() query: ListAuctionsQueryDto) {
    return this.auctionsService.listAuctions(query);
  }

  @Get(":auctionId")
  @Header("Cache-Control", "no-store")
  getAuctionById(
    @Param("auctionId", new ParseUUIDPipe({ version: "4" })) auctionId: string,
  ) {
    return this.auctionsService.getAuctionById(auctionId);
  }

  @Patch(":auctionId")
  @Header("Cache-Control", "no-store")
  updateDraft(
    @Param("auctionId", new ParseUUIDPipe({ version: "4" })) auctionId: string,
    @Body() dto: UpdateAuctionDto,
  ) {
    return this.auctionsService.updateDraft(auctionId, dto);
  }

  @Post(":auctionId/publish")
  @Header("Cache-Control", "no-store")
  @HttpCode(HttpStatus.OK)
  publishAuction(
    @Param("auctionId", new ParseUUIDPipe({ version: "4" })) auctionId: string,
    @Body() dto: PublishAuctionDto,
  ) {
    return this.auctionsService.publishAuction(auctionId, dto);
  }

  @Post(":auctionId/cancel")
  @Header("Cache-Control", "no-store")
  @HttpCode(HttpStatus.OK)
  cancelAuction(
    @Param("auctionId", new ParseUUIDPipe({ version: "4" })) auctionId: string,
    @Body() dto: CancelAuctionDto,
  ) {
    return this.auctionsService.cancelAuction(auctionId, dto);
  }
}
