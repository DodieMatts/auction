import {
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { validateCommitmentHash } from "@auction/commitment";

import { AuctionPhase } from "../auctions/types/auction-phase.enum";
import { AuctionStatus, BidStatus } from "../generated/prisma/enums";
import type { Prisma } from "../generated/prisma/client";
import { getDatabaseTime } from "../prisma/database-time";
import { PrismaService } from "../prisma/prisma.service";
import { serializableTransaction } from "../prisma/serializable-transaction";
import {
  deriveCommitmentPhase,
  mapBidCommitmentResponse,
  mapBidParticipationResponse,
} from "./bid-commitment-response.mapper";
import type { SubmitBidCommitmentDto } from "./dto/submit-bid-commitment.dto";
import type { BidCommitmentResponse } from "./types/bid-commitment-response.type";
import type { BidParticipationResponse } from "./types/bid-participation-response.type";

const auctionSelect = {
  id: true,
  currency: true,
  startTime: true,
  revealTime: true,
  endTime: true,
  status: true,
} satisfies Prisma.AuctionSelect;

const commitmentSelect = {
  id: true,
  bidId: true,
  clientRequestId: true,
  commitmentHash: true,
  protocolVersion: true,
  isCurrent: true,
  committedAt: true,
  replacedAt: true,
  bid: {
    select: {
      id: true,
      auctionId: true,
      bidderId: true,
      status: true,
      version: true,
      auction: {
        select: auctionSelect,
      },
    },
  },
} satisfies Prisma.BidCommitmentSelect;

const bidSelect = {
  id: true,
  auctionId: true,
  bidderId: true,
  status: true,
  version: true,
  commitments: {
    where: {
      isCurrent: true,
    },
    take: 1,
    select: {
      id: true,
      commitmentHash: true,
      protocolVersion: true,
      committedAt: true,
    },
  },
} satisfies Prisma.BidSelect;

type CommitmentWithBid = Prisma.BidCommitmentGetPayload<{
  select: typeof commitmentSelect;
}>;

type BidWithCurrentCommitment = Prisma.BidGetPayload<{
  select: typeof bidSelect;
}>;

@Injectable()
export class BidCommitmentsService {
  constructor(private readonly prisma: PrismaService) {}

  async submitCommitment(
    bidderId: string,
    auctionId: string,
    dto: SubmitBidCommitmentDto,
  ): Promise<BidCommitmentResponse> {
    validateCommitmentHash(dto.commitmentHash);

    try {
      return await serializableTransaction(this.prisma, async (transaction) => {
        const existingRequest = await transaction.bidCommitment.findUnique({
          where: {
            clientRequestId: dto.clientRequestId,
          },
          select: commitmentSelect,
        });

        if (existingRequest) {
          return this.handleExistingRequest(
            existingRequest,
            bidderId,
            auctionId,
            dto,
            transaction,
          );
        }

        const databaseNow = await getDatabaseTime(transaction);
        const auction = await transaction.auction.findUnique({
          where: {
            id: auctionId,
          },
          select: auctionSelect,
        });

        if (!auction || auction.status === AuctionStatus.DRAFT || auction.status === AuctionStatus.CANCELLED) {
          throw new NotFoundException("Auction not found");
        }

        const phase = deriveCommitmentPhase(auction, databaseNow);
        if (auction.status !== AuctionStatus.PUBLISHED || phase !== AuctionPhase.COMMIT) {
          throw new ConflictException("Auction is not accepting commitments");
        }

        const existingBid = await this.findBid(transaction, auctionId, bidderId);

        if (!existingBid) {
          return this.createFirstCommitment(
            transaction,
            auction,
            bidderId,
            dto,
            databaseNow,
          );
        }

        return this.replaceCommitment(
          transaction,
          auction,
          existingBid,
          dto,
          databaseNow,
        );
      });
    } catch (error) {
      this.mapPrismaConflict(error);
      throw error;
    }
  }

  async getParticipation(
    bidderId: string,
    auctionId: string,
  ): Promise<BidParticipationResponse> {
    return this.prisma.$transaction(async (transaction) => {
      const databaseNow = await getDatabaseTime(transaction);
      const auction = await transaction.auction.findFirst({
        where: {
          id: auctionId,
          status: {
            in: [AuctionStatus.PUBLISHED, AuctionStatus.SETTLED],
          },
        },
        select: auctionSelect,
      });

      if (!auction) {
        throw new NotFoundException("Auction not found");
      }

      const bid = await this.findBid(transaction, auctionId, bidderId);
      const currentCommitment = bid?.commitments[0] ?? null;

      return mapBidParticipationResponse({
        auction,
        bid: bid
          ? {
              id: bid.id,
              status: bid.status,
              version: bid.version,
              currentCommitment,
            }
          : null,
        databaseNow,
      });
    });
  }

  private async createFirstCommitment(
    transaction: Prisma.TransactionClient,
    auction: NonNullable<Prisma.AuctionGetPayload<{ select: typeof auctionSelect }>>,
    bidderId: string,
    dto: SubmitBidCommitmentDto,
    databaseNow: Date,
  ): Promise<BidCommitmentResponse> {
    if (
      dto.expectedBidVersion !== undefined &&
      dto.expectedBidVersion !== 0
    ) {
      throw new ConflictException("Bid version is stale");
    }

    const bid = await transaction.bid.create({
      data: {
        auctionId: auction.id,
        bidderId,
        status: BidStatus.COMMITTED,
        version: 1,
      },
      select: {
        id: true,
        status: true,
        version: true,
      },
    });

    const commitment = await transaction.bidCommitment.create({
      data: {
        bidId: bid.id,
        clientRequestId: dto.clientRequestId,
        commitmentHash: dto.commitmentHash,
        protocolVersion: dto.protocolVersion,
        isCurrent: true,
      },
      select: {
        id: true,
        commitmentHash: true,
        protocolVersion: true,
        committedAt: true,
      },
    });

    return mapBidCommitmentResponse({
      auction,
      bid,
      commitment,
      replacedPreviousCommitment: false,
      databaseNow,
    });
  }

  private async replaceCommitment(
    transaction: Prisma.TransactionClient,
    auction: NonNullable<Prisma.AuctionGetPayload<{ select: typeof auctionSelect }>>,
    bid: BidWithCurrentCommitment,
    dto: SubmitBidCommitmentDto,
    databaseNow: Date,
  ): Promise<BidCommitmentResponse> {
    if (dto.expectedBidVersion === undefined) {
      throw new ConflictException("Bid version is required");
    }

    if (bid.version !== dto.expectedBidVersion) {
      throw new ConflictException("Bid version is stale");
    }

    const currentCommitment = bid.commitments[0];
    if (!currentCommitment) {
      throw new ConflictException("Current commitment is unavailable");
    }

    const bidUpdate = await transaction.bid.updateMany({
      where: {
        id: bid.id,
        version: dto.expectedBidVersion,
      },
      data: {
        version: {
          increment: 1,
        },
      },
    });

    if (bidUpdate.count !== 1) {
      throw new ConflictException("Bid version is stale");
    }

    await transaction.bidCommitment.updateMany({
      where: {
        id: currentCommitment.id,
        bidId: bid.id,
        isCurrent: true,
      },
      data: {
        isCurrent: false,
        replacedAt: databaseNow,
      },
    });

    const commitment = await transaction.bidCommitment.create({
      data: {
        bidId: bid.id,
        clientRequestId: dto.clientRequestId,
        commitmentHash: dto.commitmentHash,
        protocolVersion: dto.protocolVersion,
        isCurrent: true,
      },
      select: {
        id: true,
        commitmentHash: true,
        protocolVersion: true,
        committedAt: true,
      },
    });

    return mapBidCommitmentResponse({
      auction,
      bid: {
        id: bid.id,
        status: bid.status,
        version: bid.version + 1,
      },
      commitment,
      replacedPreviousCommitment: true,
      databaseNow,
    });
  }

  private async handleExistingRequest(
    existingRequest: CommitmentWithBid,
    bidderId: string,
    auctionId: string,
    dto: SubmitBidCommitmentDto,
    transaction: Prisma.TransactionClient,
  ): Promise<BidCommitmentResponse> {
    if (
      existingRequest.bid.auctionId !== auctionId ||
      existingRequest.bid.bidderId !== bidderId ||
      existingRequest.commitmentHash !== dto.commitmentHash ||
      existingRequest.protocolVersion !== dto.protocolVersion
    ) {
      throw new ConflictException("Commitment request identifier conflict");
    }

    const databaseNow = await getDatabaseTime(transaction);

    return mapBidCommitmentResponse({
      auction: existingRequest.bid.auction,
      bid: {
        id: existingRequest.bid.id,
        status: existingRequest.bid.status,
        version: existingRequest.bid.version,
      },
      commitment: {
        id: existingRequest.id,
        commitmentHash: existingRequest.commitmentHash,
        protocolVersion: existingRequest.protocolVersion,
        committedAt: existingRequest.committedAt,
      },
      replacedPreviousCommitment: existingRequest.replacedAt !== null,
      databaseNow,
    });
  }

  private async findBid(
    transaction: Prisma.TransactionClient,
    auctionId: string,
    bidderId: string,
  ): Promise<BidWithCurrentCommitment | null> {
    return transaction.bid.findUnique({
      where: {
        auctionId_bidderId: {
          auctionId,
          bidderId,
        },
      },
      select: bidSelect,
    });
  }

  private mapPrismaConflict(error: unknown): never | void {
    if (!isPrismaKnownError(error, "P2002")) {
      return;
    }

    const target = getPrismaTarget(error);
    if (target.includes("clientRequestId")) {
      throw new ConflictException("Commitment request identifier conflict");
    }

    if (target.includes("commitmentHash")) {
      throw new ConflictException("Commitment hash was already used");
    }

    if (target.includes("auctionId") && target.includes("bidderId")) {
      throw new ConflictException("Bid already exists");
    }

    throw new ConflictException("Commitment could not be submitted");
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
