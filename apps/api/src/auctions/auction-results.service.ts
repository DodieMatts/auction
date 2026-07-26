import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from "@nestjs/common";

import {
  AuctionStatus,
  BidStatus,
  RevealValidationStatus,
} from "../generated/prisma/enums";
import type { Prisma } from "../generated/prisma/client";
import { getDatabaseTime } from "../prisma/database-time";
import { PrismaService } from "../prisma/prisma.service";
import { mapAdminAuctionResult } from "./admin-auction-result.mapper";
import { validateSettledAuctionInvariants } from "./auction-results-domain.utils";
import { mapBidderAuctionResult } from "./bidder-auction-result.mapper";
import type { AdminAuctionResultResponse } from "./types/admin-auction-result-response.type";
import type { BidderAuctionResultResponse } from "./types/bidder-auction-result-response.type";
import type { SettledAuctionData } from "./types/settled-auction-data.type";

const resultAuctionSelect = {
  id: true,
  title: true,
  description: true,
  currency: true,
  startTime: true,
  revealTime: true,
  endTime: true,
  status: true,
  settledAt: true,
  version: true,
} satisfies Prisma.AuctionSelect;

const resultBidSelect = {
  id: true,
  bidderId: true,
  status: true,
  commitments: {
    where: {
      isCurrent: true,
    },
    select: {
      id: true,
      isCurrent: true,
    },
  },
  revealAttempts: {
    where: {
      validationStatus: RevealValidationStatus.VALID,
    },
    select: {
      amountCents: true,
      validationStatus: true,
    },
  },
} satisfies Prisma.BidSelect;

type ResultAuction = Prisma.AuctionGetPayload<{
  select: typeof resultAuctionSelect;
}>;
type ResultBid = Prisma.BidGetPayload<{ select: typeof resultBidSelect }>;

@Injectable()
export class AuctionResultsService {
  constructor(private readonly prisma: PrismaService) {}

  async getBidderResult(
    bidderId: string,
    auctionId: string,
  ): Promise<BidderAuctionResultResponse> {
    return this.prisma.$transaction(async (transaction) => {
      const serverTime = await getDatabaseTime(transaction);
      const auction = await this.loadAuction(transaction, auctionId);

      if (!auction) {
        throw new NotFoundException("Auction not found");
      }

      if (
        auction.status === AuctionStatus.DRAFT ||
        auction.status === AuctionStatus.CANCELLED
      ) {
        throw new NotFoundException("Auction not found");
      }

      this.requireResultsAvailable(auction);

      const data = await this.buildSettledAuctionData(
        transaction,
        auction,
        serverTime,
        bidderId,
      );

      return mapBidderAuctionResult(data);
    });
  }

  async getAdminResult(auctionId: string): Promise<AdminAuctionResultResponse> {
    return this.prisma.$transaction(async (transaction) => {
      const serverTime = await getDatabaseTime(transaction);
      const auction = await this.loadAuction(transaction, auctionId);

      if (!auction) {
        throw new NotFoundException("Auction not found");
      }

      this.requireResultsAvailable(auction);

      const data = await this.buildSettledAuctionData(transaction, auction, serverTime);

      return mapAdminAuctionResult(data);
    });
  }

  private async loadAuction(
    transaction: Prisma.TransactionClient,
    auctionId: string,
  ): Promise<ResultAuction | null> {
    return transaction.auction.findUnique({
      where: {
        id: auctionId,
      },
      select: resultAuctionSelect,
    });
  }

  private requireResultsAvailable(auction: ResultAuction): void {
    if (auction.status !== AuctionStatus.SETTLED || auction.settledAt === null) {
      throw new ConflictException("Auction results are not available");
    }
  }

  private async buildSettledAuctionData(
    transaction: Prisma.TransactionClient,
    auction: ResultAuction,
    serverTime: Date,
    requestingBidderId?: string,
  ): Promise<SettledAuctionData> {
    const bids = await transaction.bid.findMany({
      where: {
        auctionId: auction.id,
      },
      orderBy: {
        id: "asc",
      },
      select: resultBidSelect,
    });

    validateSettledAuctionInvariants({ auction, bids });

    const totalBidCount = bids.length;
    const validRevealCount = bids.filter(
      (bid) => bid.status === BidStatus.WON || bid.status === BidStatus.LOST,
    ).length;
    const invalidBidCount = bids.filter(
      (bid) => bid.status === BidStatus.INVALID,
    ).length;

    if (validRevealCount + invalidBidCount !== totalBidCount) {
      throw new InternalServerErrorException("Auction result data is inconsistent");
    }

    const winnerBid = bids.find((bid) => bid.status === BidStatus.WON) ?? null;
    const requestingBidderBid =
      requestingBidderId === undefined
        ? null
        : bids.find((bid) => bid.bidderId === requestingBidderId) ?? null;

    return {
      auction,
      serverTime,
      totalBidCount,
      validRevealCount,
      invalidBidCount,
      winner: await this.mapWinner(transaction, winnerBid),
      requestingBidderParticipation: requestingBidderBid
        ? {
            bidId: requestingBidderBid.id,
            status: requestingBidderBid.status,
            amountCents: this.getValidRevealAmount(requestingBidderBid),
          }
        : null,
    };
  }

  private async mapWinner(
    transaction: Prisma.TransactionClient,
    winnerBid: ResultBid | null,
  ): Promise<SettledAuctionData["winner"]> {
    if (!winnerBid) {
      return null;
    }

    const bidder = await transaction.user.findUnique({
      where: {
        id: winnerBid.bidderId,
      },
      select: {
        id: true,
        email: true,
      },
    });

    if (!bidder) {
      throw new InternalServerErrorException("Auction result data is inconsistent");
    }

    return {
      bidId: winnerBid.id,
      bidderId: bidder.id,
      bidderEmail: bidder.email,
      amountCents: this.requireValidRevealAmount(winnerBid),
    };
  }

  private getValidRevealAmount(bid: ResultBid): bigint | null {
    if (bid.status === BidStatus.WON || bid.status === BidStatus.LOST) {
      return this.requireValidRevealAmount(bid);
    }

    return null;
  }

  private requireValidRevealAmount(bid: ResultBid): bigint {
    const amount = bid.revealAttempts[0]?.amountCents;

    if (amount === undefined) {
      throw new InternalServerErrorException("Auction result data is inconsistent");
    }

    return amount;
  }
}
