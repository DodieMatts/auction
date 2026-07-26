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
import { BidCommitmentsService } from "./bid-commitments.service";
import { SubmitBidCommitmentDto } from "./dto/submit-bid-commitment.dto";

@Roles(UserRole.BIDDER)
@Controller("auctions/:auctionId")
export class BidCommitmentsController {
  constructor(private readonly bidCommitmentsService: BidCommitmentsService) {}

  @Post("commitments")
  @Header("Cache-Control", "no-store")
  submitCommitment(
    @CurrentUser() user: PublicUser,
    @Param("auctionId", new ParseUUIDPipe({ version: "4" })) auctionId: string,
    @Body() dto: SubmitBidCommitmentDto,
  ) {
    return this.bidCommitmentsService.submitCommitment(user.id, auctionId, dto);
  }

  @Get("participation")
  @Header("Cache-Control", "no-store")
  getParticipation(
    @CurrentUser() user: PublicUser,
    @Param("auctionId", new ParseUUIDPipe({ version: "4" })) auctionId: string,
  ) {
    return this.bidCommitmentsService.getParticipation(user.id, auctionId);
  }
}
