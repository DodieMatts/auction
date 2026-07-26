import { Injectable, NotFoundException } from "@nestjs/common";

import { AuctionStatus } from "../generated/prisma/enums";
import type { Prisma } from "../generated/prisma/client";
import { getDatabaseTime } from "../prisma/database-time";
import { PrismaService } from "../prisma/prisma.service";
import {
  mapBidderAuctionResponse,
  type BidderAuctionRecord,
} from "./bidder-auction-response.mapper";
import type { ListBidderAuctionsQueryDto } from "./dto/list-bidder-auctions-query.dto";
import type { BidderAuctionListResponse } from "./types/bidder-auction-list-response.type";
import type { SingleBidderAuctionResponse } from "./types/bidder-auction-response.type";

const visibleAuctionStatuses = [AuctionStatus.PUBLISHED, AuctionStatus.SETTLED];

const bidderAuctionSelect = {
  id: true,
  title: true,
  description: true,
  currency: true,
  startTime: true,
  revealTime: true,
  endTime: true,
  status: true,
} satisfies Prisma.AuctionSelect;

@Injectable()
export class BidderAuctionsService {
  constructor(private readonly prisma: PrismaService) {}

  async listVisibleAuctions(
    query: ListBidderAuctionsQueryDto,
  ): Promise<BidderAuctionListResponse> {
    const page = query.page;
    const limit = query.limit;
    const where = {
      status: {
        in: visibleAuctionStatuses,
      },
    };

    return this.prisma.$transaction(async (transaction) => {
      const databaseNow = await getDatabaseTime(transaction);
      const [total, auctions] = await Promise.all([
        transaction.auction.count({ where }),
        transaction.auction.findMany({
          where,
          orderBy: [{ startTime: "desc" }, { id: "desc" }],
          skip: (page - 1) * limit,
          take: limit,
          select: bidderAuctionSelect,
        }),
      ]);

      return {
        data: auctions.map((auction) =>
          mapBidderAuctionResponse(auction, databaseNow),
        ),
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
        serverTime: databaseNow.toISOString(),
      };
    });
  }

  async getVisibleAuctionById(
    auctionId: string,
  ): Promise<SingleBidderAuctionResponse> {
    return this.prisma.$transaction(async (transaction) => {
      const databaseNow = await getDatabaseTime(transaction);
      const auction = await transaction.auction.findFirst({
        where: {
          id: auctionId,
          status: {
            in: visibleAuctionStatuses,
          },
        },
        select: bidderAuctionSelect,
      });

      if (!auction) {
        throw new NotFoundException("Auction not found");
      }

      return this.singleResponse(auction, databaseNow);
    });
  }

  private singleResponse(
    auction: BidderAuctionRecord,
    databaseNow: Date,
  ): SingleBidderAuctionResponse {
    return {
      auction: mapBidderAuctionResponse(auction, databaseNow),
      serverTime: databaseNow.toISOString(),
    };
  }
}
