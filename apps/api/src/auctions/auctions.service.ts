import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";

import { AuctionStatus } from "../generated/prisma/enums";
import type { Prisma } from "../generated/prisma/client";
import { getDatabaseTime } from "../prisma/database-time";
import { PrismaService } from "../prisma/prisma.service";
import { serializableTransaction } from "../prisma/serializable-transaction";
import {
  auctionCreateInputMatches,
  normalizeCurrency,
  normalizeDescription,
  normalizeTitle,
  parseAuctionDate,
  validateAuctionSchedule,
  type NormalizedAuctionCreateInput,
} from "./auction-domain.utils";
import { mapAuctionResponse, type AuctionRecord } from "./auction-response.mapper";
import type { CancelAuctionDto } from "./dto/cancel-auction.dto";
import type { CreateAuctionDto } from "./dto/create-auction.dto";
import type { ListAuctionsQueryDto } from "./dto/list-auctions-query.dto";
import type { PublishAuctionDto } from "./dto/publish-auction.dto";
import type { UpdateAuctionDto } from "./dto/update-auction.dto";
import type { AuctionListResponse } from "./types/auction-list-response.type";
import type { SingleAuctionResponse } from "./types/auction-response.type";

const auctionSelect = {
  id: true,
  creationRequestId: true,
  title: true,
  description: true,
  currency: true,
  startTime: true,
  revealTime: true,
  endTime: true,
  status: true,
  createdById: true,
  settlementRequestId: true,
  cancellationRequestId: true,
  settledAt: true,
  cancelledAt: true,
  cancellationReason: true,
  version: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.AuctionSelect;

type InternalAuctionRecord = NonNullable<
  Prisma.AuctionGetPayload<{ select: typeof auctionSelect }>
>;

@Injectable()
export class AuctionsService {
  constructor(private readonly prisma: PrismaService) {}

  async createDraft(
    adminUserId: string,
    dto: CreateAuctionDto,
  ): Promise<SingleAuctionResponse> {
    const normalizedInput = this.normalizeCreateInput(adminUserId, dto);

    try {
      return await serializableTransaction(this.prisma, async (transaction) => {
        const existingAuction = await transaction.auction.findUnique({
          where: {
            creationRequestId: dto.creationRequestId,
          },
          select: auctionSelect,
        });

        if (existingAuction) {
          return this.handleExistingCreation(existingAuction, normalizedInput);
        }

        const databaseNow = await getDatabaseTime(transaction);
        validateAuctionSchedule(normalizedInput, databaseNow);

        const auction = await transaction.auction.create({
          data: {
            creationRequestId: dto.creationRequestId,
            title: normalizedInput.title,
            description: normalizedInput.description,
            currency: normalizedInput.currency,
            startTime: normalizedInput.startTime,
            revealTime: normalizedInput.revealTime,
            endTime: normalizedInput.endTime,
            status: AuctionStatus.DRAFT,
            createdById: normalizedInput.createdById,
          },
          select: auctionSelect,
        });

        return this.singleResponse(auction, databaseNow);
      });
    } catch (error) {
      if (isUniqueConstraintError(error, "creationRequestId")) {
        const existingAuction = await this.prisma.auction.findUnique({
          where: {
            creationRequestId: dto.creationRequestId,
          },
          select: auctionSelect,
        });

        if (existingAuction) {
          return this.handleExistingCreation(existingAuction, normalizedInput);
        }
      }

      throw error;
    }
  }

  async listAuctions(query: ListAuctionsQueryDto): Promise<AuctionListResponse> {
    const page = query.page;
    const limit = query.limit;
    const where = query.status ? { status: query.status } : {};

    return this.prisma.$transaction(async (transaction) => {
      const databaseNow = await getDatabaseTime(transaction);
      const [total, auctions] = await Promise.all([
        transaction.auction.count({ where }),
        transaction.auction.findMany({
          where,
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          skip: (page - 1) * limit,
          take: limit,
          select: auctionSelect,
        }),
      ]);

      return {
        data: auctions.map((auction) => mapAuctionResponse(auction, databaseNow)),
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

  async getAuctionById(auctionId: string): Promise<SingleAuctionResponse> {
    return this.prisma.$transaction(async (transaction) => {
      const databaseNow = await getDatabaseTime(transaction);
      const auction = await transaction.auction.findUnique({
        where: {
          id: auctionId,
        },
        select: auctionSelect,
      });

      if (!auction) {
        throw new NotFoundException("Auction not found");
      }

      return this.singleResponse(auction, databaseNow);
    });
  }

  async updateDraft(
    auctionId: string,
    dto: UpdateAuctionDto,
  ): Promise<SingleAuctionResponse> {
    if (!this.hasEditableUpdateFields(dto)) {
      throw new BadRequestException("At least one editable field is required");
    }

    return serializableTransaction(this.prisma, async (transaction) => {
      const databaseNow = await getDatabaseTime(transaction);
      const auction = await transaction.auction.findUnique({
        where: {
          id: auctionId,
        },
        select: auctionSelect,
      });

      if (!auction) {
        throw new NotFoundException("Auction not found");
      }

      if (auction.status !== AuctionStatus.DRAFT) {
        throw new ConflictException("Only draft auctions can be updated");
      }

      if (auction.version !== dto.expectedVersion) {
        throw new ConflictException("Auction version is stale");
      }

      const merged = {
        title:
          dto.title === undefined ? auction.title : normalizeTitle(dto.title),
        description:
          dto.description === undefined
            ? auction.description
            : normalizeDescription(dto.description),
        currency:
          dto.currency === undefined
            ? auction.currency
            : normalizeCurrency(dto.currency),
        startTime:
          dto.startTime === undefined
            ? auction.startTime
            : parseAuctionDate(dto.startTime),
        revealTime:
          dto.revealTime === undefined
            ? auction.revealTime
            : parseAuctionDate(dto.revealTime),
        endTime:
          dto.endTime === undefined ? auction.endTime : parseAuctionDate(dto.endTime),
      };

      validateAuctionSchedule(merged, databaseNow);

      const updateResult = await transaction.auction.updateMany({
        where: {
          id: auctionId,
          status: AuctionStatus.DRAFT,
          version: dto.expectedVersion,
        },
        data: {
          ...merged,
          version: {
            increment: 1,
          },
        },
      });

      if (updateResult.count !== 1) {
        throw new ConflictException("Auction version is stale");
      }

      const updatedAuction = await this.requireAuction(transaction, auctionId);

      return this.singleResponse(updatedAuction, databaseNow);
    });
  }

  async publishAuction(
    auctionId: string,
    dto: PublishAuctionDto,
  ): Promise<SingleAuctionResponse> {
    return serializableTransaction(this.prisma, async (transaction) => {
      const databaseNow = await getDatabaseTime(transaction);
      const auction = await transaction.auction.findUnique({
        where: {
          id: auctionId,
        },
        select: auctionSelect,
      });

      if (!auction) {
        throw new NotFoundException("Auction not found");
      }

      if (auction.status === AuctionStatus.PUBLISHED) {
        return this.singleResponse(auction, databaseNow);
      }

      if (
        auction.status === AuctionStatus.CANCELLED ||
        auction.status === AuctionStatus.SETTLED
      ) {
        throw new ConflictException("Auction cannot be published");
      }

      if (auction.status !== AuctionStatus.DRAFT) {
        throw new ConflictException("Auction cannot be published");
      }

      if (auction.version !== dto.expectedVersion) {
        throw new ConflictException("Auction version is stale");
      }

      if (auction.startTime.getTime() <= databaseNow.getTime()) {
        throw new ConflictException("Auction start time must be in the future");
      }

      const updateResult = await transaction.auction.updateMany({
        where: {
          id: auctionId,
          status: AuctionStatus.DRAFT,
          version: dto.expectedVersion,
        },
        data: {
          status: AuctionStatus.PUBLISHED,
          version: {
            increment: 1,
          },
        },
      });

      if (updateResult.count !== 1) {
        throw new ConflictException("Auction version is stale");
      }

      const updatedAuction = await this.requireAuction(transaction, auctionId);

      return this.singleResponse(updatedAuction, databaseNow);
    });
  }

  async cancelAuction(
    auctionId: string,
    dto: CancelAuctionDto,
  ): Promise<SingleAuctionResponse> {
    const reason = dto.reason.trim();

    if (reason.length === 0 || reason.length > 500) {
      throw new BadRequestException("Cancellation reason must be between 1 and 500 characters");
    }

    const existingRequest = await this.prisma.auction.findUnique({
      where: {
        cancellationRequestId: dto.cancellationRequestId,
      },
      select: auctionSelect,
    });

    if (existingRequest) {
      return this.handleExistingCancellation(existingRequest, auctionId, reason);
    }

    try {
      return await serializableTransaction(this.prisma, async (transaction) => {
        const databaseNow = await getDatabaseTime(transaction);
        const auction = await transaction.auction.findUnique({
          where: {
            id: auctionId,
          },
          select: auctionSelect,
        });

        if (!auction) {
          throw new NotFoundException("Auction not found");
        }

        if (auction.version !== dto.expectedVersion) {
          throw new ConflictException("Auction version is stale");
        }

        if (auction.status === AuctionStatus.SETTLED) {
          throw new ConflictException("Settled auctions cannot be cancelled");
        }

        if (auction.status === AuctionStatus.CANCELLED) {
          throw new ConflictException("Auction is already cancelled");
        }

        if (
          auction.status === AuctionStatus.PUBLISHED &&
          auction.startTime.getTime() <= databaseNow.getTime()
        ) {
          throw new ConflictException("Started auctions cannot be cancelled");
        }

        if (
          auction.status !== AuctionStatus.DRAFT &&
          auction.status !== AuctionStatus.PUBLISHED
        ) {
          throw new ConflictException("Auction cannot be cancelled");
        }

        const updateResult = await transaction.auction.updateMany({
          where: {
            id: auctionId,
            version: dto.expectedVersion,
          },
          data: {
            status: AuctionStatus.CANCELLED,
            cancelledAt: databaseNow,
            cancellationRequestId: dto.cancellationRequestId,
            cancellationReason: reason,
            version: {
              increment: 1,
            },
          },
        });

        if (updateResult.count !== 1) {
          throw new ConflictException("Auction version is stale");
        }

        const cancelledAuction = await this.requireAuction(transaction, auctionId);

        return this.singleResponse(cancelledAuction, databaseNow);
      });
    } catch (error) {
      if (isUniqueConstraintError(error, "cancellationRequestId")) {
        const auction = await this.prisma.auction.findUnique({
          where: {
            cancellationRequestId: dto.cancellationRequestId,
          },
          select: auctionSelect,
        });

        if (auction) {
          return this.handleExistingCancellation(auction, auctionId, reason);
        }
      }

      throw error;
    }
  }

  private async requireAuction(
    transaction: Prisma.TransactionClient,
    auctionId: string,
  ): Promise<InternalAuctionRecord> {
    const auction = await transaction.auction.findUnique({
      where: {
        id: auctionId,
      },
      select: auctionSelect,
    });

    if (!auction) {
      throw new NotFoundException("Auction not found");
    }

    return auction;
  }

  private normalizeCreateInput(
    adminUserId: string,
    dto: CreateAuctionDto,
  ): NormalizedAuctionCreateInput {
    return {
      createdById: adminUserId,
      title: normalizeTitle(dto.title),
      description: normalizeDescription(dto.description),
      currency: normalizeCurrency(dto.currency),
      startTime: parseAuctionDate(dto.startTime),
      revealTime: parseAuctionDate(dto.revealTime),
      endTime: parseAuctionDate(dto.endTime),
    };
  }

  private async handleExistingCreation(
    existingAuction: InternalAuctionRecord,
    normalizedInput: NormalizedAuctionCreateInput,
  ): Promise<SingleAuctionResponse> {
    if (!auctionCreateInputMatches(existingAuction, normalizedInput)) {
      throw new ConflictException("Creation request conflicts with existing auction");
    }

    const databaseNow = await this.prisma.$transaction((transaction) =>
      getDatabaseTime(transaction),
    );

    return this.singleResponse(existingAuction, databaseNow);
  }

  private async handleExistingCancellation(
    auction: InternalAuctionRecord,
    auctionId: string,
    reason: string,
  ): Promise<SingleAuctionResponse> {
    if (auction.id !== auctionId || auction.cancellationReason !== reason) {
      throw new ConflictException("Cancellation request conflicts with existing auction");
    }

    const databaseNow = await this.prisma.$transaction((transaction) =>
      getDatabaseTime(transaction),
    );

    return this.singleResponse(auction, databaseNow);
  }

  private singleResponse(
    auction: AuctionRecord,
    databaseNow: Date,
  ): SingleAuctionResponse {
    return {
      auction: mapAuctionResponse(auction, databaseNow),
      serverTime: databaseNow.toISOString(),
    };
  }

  private hasEditableUpdateFields(dto: UpdateAuctionDto): boolean {
    return (
      dto.title !== undefined ||
      dto.description !== undefined ||
      dto.currency !== undefined ||
      dto.startTime !== undefined ||
      dto.revealTime !== undefined ||
      dto.endTime !== undefined
    );
  }
}

function isUniqueConstraintError(error: unknown, fieldName: string): boolean {
  if (
    typeof error !== "object" ||
    error === null ||
    !("code" in error) ||
    error.code !== "P2002"
  ) {
    return false;
  }

  const target = "meta" in error ? error.meta : undefined;

  return (
    typeof target === "object" &&
    target !== null &&
    "target" in target &&
    Array.isArray(target.target) &&
    target.target.includes(fieldName)
  );
}
