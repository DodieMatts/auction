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
import { serializableTransaction } from "../prisma/serializable-transaction";
import {
  selectSettlementWinner,
  validateSettlementBidInvariants,
} from "./auction-settlement-domain.utils";
import { mapAuctionSettlementResponse } from "./auction-settlement-response.mapper";
import type { SettleAuctionDto } from "./dto/settle-auction.dto";
import type { AuctionSettlementResponse } from "./types/auction-settlement-response.type";
import type { SettlementCandidate } from "./types/settlement-candidate.type";
import type { SettlementSummary } from "./types/settlement-summary.type";

const auctionSettlementSelect = {
  id: true,
  status: true,
  startTime: true,
  revealTime: true,
  endTime: true,
  version: true,
  settlementRequestId: true,
  settledAt: true,
} satisfies Prisma.AuctionSelect;

const settlementBidSelect = {
  id: true,
  bidderId: true,
  status: true,
  version: true,
  commitments: {
    where: {
      isCurrent: true,
    },
    select: {
      id: true,
      committedAt: true,
      isCurrent: true,
    },
  },
  revealAttempts: {
    where: {
      validationStatus: RevealValidationStatus.VALID,
    },
    select: {
      id: true,
      amountCents: true,
      submittedAt: true,
      validationStatus: true,
    },
  },
} satisfies Prisma.BidSelect;

type SettlementAuction = Prisma.AuctionGetPayload<{
  select: typeof auctionSettlementSelect;
}>;
type SettlementBid = Prisma.BidGetPayload<{ select: typeof settlementBidSelect }>;

@Injectable()
export class AuctionSettlementService {
  constructor(private readonly prisma: PrismaService) {}

  async settleAuction(
    adminUserId: string,
    auctionId: string,
    dto: SettleAuctionDto,
  ): Promise<AuctionSettlementResponse> {
    void adminUserId;

    const existingRequest = await this.prisma.auction.findUnique({
      where: {
        settlementRequestId: dto.settlementRequestId,
      },
      select: auctionSettlementSelect,
    });

    if (existingRequest) {
      return this.handleExistingSettlementRequest(existingRequest, auctionId);
    }

    try {
      return await serializableTransaction(this.prisma, async (transaction) => {
        const databaseNow = await getDatabaseTime(transaction);
        const auction = await transaction.auction.findUnique({
          where: {
            id: auctionId,
          },
          select: auctionSettlementSelect,
        });

        if (!auction) {
          throw new NotFoundException("Auction not found");
        }

        this.validateAuctionCanSettle(auction, dto, databaseNow);

        const bids = await this.loadSettlementBids(transaction, auctionId);
        validateSettlementBidInvariants(bids);

        const winner = selectSettlementWinner(this.buildCandidates(bids));

        const invalidatedBids = await transaction.bid.updateMany({
          where: {
            auctionId,
            status: BidStatus.COMMITTED,
          },
          data: {
            status: BidStatus.INVALID,
            version: {
              increment: 1,
            },
          },
        });

        const losingBids = winner
          ? await transaction.bid.updateMany({
              where: {
                auctionId,
                status: BidStatus.REVEALED,
                id: {
                  not: winner.bidId,
                },
              },
              data: {
                status: BidStatus.LOST,
                version: {
                  increment: 1,
                },
              },
            })
          : { count: 0 };

        if (winner) {
          const winnerUpdate = await transaction.bid.updateMany({
            where: {
              id: winner.bidId,
              auctionId,
              status: BidStatus.REVEALED,
            },
            data: {
              status: BidStatus.WON,
              version: {
                increment: 1,
              },
            },
          });

          if (winnerUpdate.count !== 1) {
            throw new ConflictException("Auction settlement conflict");
          }
        }

        const auctionUpdate = await transaction.auction.updateMany({
          where: {
            id: auctionId,
            status: AuctionStatus.PUBLISHED,
            version: dto.expectedVersion,
            settlementRequestId: null,
          },
          data: {
            status: AuctionStatus.SETTLED,
            settledAt: databaseNow,
            settlementRequestId: dto.settlementRequestId,
            version: {
              increment: 1,
            },
          },
        });

        if (auctionUpdate.count !== 1) {
          throw new ConflictException("Auction version conflict");
        }

        const settledAuction = await this.requireAuction(transaction, auctionId);
        const summary = await this.buildSettlementSummary(transaction, auctionId, winner);

        this.assertFinalizedSummary(bids.length, summary);

        return mapAuctionSettlementResponse({
          auction: settledAuction,
          summary,
          databaseNow,
        });
      });
    } catch (error) {
      const conflictResult = await this.mapPrismaConflict(error, auctionId, dto);
      if (conflictResult) {
        return conflictResult;
      }

      throw error;
    }
  }

  private validateAuctionCanSettle(
    auction: SettlementAuction,
    dto: SettleAuctionDto,
    databaseNow: Date,
  ): void {
    if (
      auction.status === AuctionStatus.DRAFT ||
      auction.status === AuctionStatus.CANCELLED
    ) {
      throw new ConflictException("Auction cannot be settled");
    }

    if (auction.status === AuctionStatus.SETTLED) {
      throw new ConflictException("Auction was already settled");
    }

    if (auction.status !== AuctionStatus.PUBLISHED) {
      throw new ConflictException("Auction cannot be settled");
    }

    if (auction.endTime.getTime() > databaseNow.getTime()) {
      throw new ConflictException("Auction has not ended");
    }

    if (auction.version !== dto.expectedVersion) {
      throw new ConflictException("Auction version conflict");
    }
  }

  private async handleExistingSettlementRequest(
    auction: SettlementAuction,
    auctionId: string,
  ): Promise<AuctionSettlementResponse> {
    if (auction.id !== auctionId || auction.status !== AuctionStatus.SETTLED) {
      throw new ConflictException("Settlement request identifier conflict");
    }

    return this.prisma.$transaction(async (transaction) => {
      const databaseNow = await getDatabaseTime(transaction);
      const settledAuction = await this.requireAuction(transaction, auctionId);
      const summary = await this.buildSettlementSummary(transaction, auctionId);

      return mapAuctionSettlementResponse({
        auction: settledAuction,
        summary,
        databaseNow,
      });
    });
  }

  private async loadSettlementBids(
    transaction: Prisma.TransactionClient,
    auctionId: string,
  ): Promise<SettlementBid[]> {
    return transaction.bid.findMany({
      where: {
        auctionId,
      },
      orderBy: {
        id: "asc",
      },
      select: settlementBidSelect,
    });
  }

  private buildCandidates(bids: SettlementBid[]): SettlementCandidate[] {
    return bids
      .filter((bid) => bid.status === BidStatus.REVEALED)
      .map((bid) => ({
        bidId: bid.id,
        bidderId: bid.bidderId,
        amountCents: bid.revealAttempts[0].amountCents,
        commitmentCommittedAt: bid.commitments[0].committedAt,
      }));
  }

  private async requireAuction(
    transaction: Prisma.TransactionClient,
    auctionId: string,
  ): Promise<SettlementAuction> {
    const auction = await transaction.auction.findUnique({
      where: {
        id: auctionId,
      },
      select: auctionSettlementSelect,
    });

    if (!auction) {
      throw new NotFoundException("Auction not found");
    }

    return auction;
  }

  private async buildSettlementSummary(
    transaction: Prisma.TransactionClient,
    auctionId: string,
    selectedWinner?: SettlementCandidate | null,
  ): Promise<SettlementSummary> {
    const bids = await transaction.bid.findMany({
      where: {
        auctionId,
      },
      select: {
        id: true,
        bidderId: true,
        status: true,
        revealAttempts: {
          where: {
            validationStatus: RevealValidationStatus.VALID,
          },
          take: 1,
          select: {
            amountCents: true,
          },
        },
      },
    });

    const lingeringActiveBid = bids.find(
      (bid) => bid.status === BidStatus.COMMITTED || bid.status === BidStatus.REVEALED,
    );
    if (lingeringActiveBid) {
      throw new InternalServerErrorException("Auction data is inconsistent");
    }

    const winnerBid = bids.find((bid) => bid.status === BidStatus.WON) ?? null;
    const validRevealCount = bids.filter(
      (bid) => bid.status === BidStatus.WON || bid.status === BidStatus.LOST,
    ).length;
    const invalidBidCount = bids.filter((bid) => bid.status === BidStatus.INVALID).length;

    return {
      totalBidCount: bids.length,
      validRevealCount,
      invalidBidCount,
      winner: winnerBid
        ? {
            bidId: winnerBid.id,
            bidderId: winnerBid.bidderId,
            amountCents:
              selectedWinner?.bidId === winnerBid.id
                ? selectedWinner.amountCents.toString()
                : this.requireWinnerAmount(winnerBid.revealAttempts[0]?.amountCents),
          }
        : null,
    };
  }

  private requireWinnerAmount(amount: bigint | undefined): string {
    if (amount === undefined) {
      throw new InternalServerErrorException("Auction data is inconsistent");
    }

    return amount.toString();
  }

  private assertFinalizedSummary(
    originalBidCount: number,
    summary: SettlementSummary,
  ): void {
    if (
      originalBidCount !== summary.totalBidCount ||
      summary.validRevealCount + summary.invalidBidCount !== summary.totalBidCount
    ) {
      throw new InternalServerErrorException("Auction data is inconsistent");
    }
  }

  private async mapPrismaConflict(
    error: unknown,
    auctionId: string,
    dto: SettleAuctionDto,
  ): Promise<AuctionSettlementResponse | never | void> {
    if (!isPrismaKnownError(error, "P2002")) {
      return;
    }

    const target = getPrismaTarget(error);

    if (target.includes("settlementRequestId")) {
      const existingAuction = await this.prisma.auction.findUnique({
        where: {
          settlementRequestId: dto.settlementRequestId,
        },
        select: auctionSettlementSelect,
      });

      if (existingAuction?.id === auctionId && existingAuction.status === AuctionStatus.SETTLED) {
        return this.handleExistingSettlementRequest(existingAuction, auctionId);
      }

      throw new ConflictException("Settlement request identifier conflict");
    }

    if (target.includes("auctionId")) {
      const auction = await this.prisma.auction.findUnique({
        where: {
          id: auctionId,
        },
        select: auctionSettlementSelect,
      });

      if (auction?.status === AuctionStatus.SETTLED) {
        return this.handleExistingSettlementRequest(auction, auctionId);
      }
    }

    throw new InternalServerErrorException("Auction data is inconsistent");
  }
}

function isPrismaKnownError(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === code
  );
}

function getPrismaTarget(error: unknown): string[] {
  if (
    typeof error !== "object" ||
    error === null ||
    !("meta" in error) ||
    typeof error.meta !== "object" ||
    error.meta === null ||
    !("target" in error.meta) ||
    !Array.isArray(error.meta.target)
  ) {
    return [];
  }

  return error.meta.target.filter((value): value is string => typeof value === "string");
}
