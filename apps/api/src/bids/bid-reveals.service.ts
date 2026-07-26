import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import {
  computeBidCommitmentV1,
  validateAmountCents,
  validateProtocolVersion,
  validateSecret,
} from "@auction/commitment";
import { timingSafeEqual } from "node:crypto";

import { AuctionPhase } from "../auctions/types/auction-phase.enum";
import {
  AuctionStatus,
  BidStatus,
  RevealValidationStatus,
} from "../generated/prisma/enums";
import type { Prisma } from "../generated/prisma/client";
import { getDatabaseTime } from "../prisma/database-time";
import { PrismaService } from "../prisma/prisma.service";
import { serializableTransaction } from "../prisma/serializable-transaction";
import { constantTimeCommitmentHashEquals } from "./commitment-hash-comparison";
import type { SubmitBidRevealDto } from "./dto/submit-bid-reveal.dto";
import {
  deriveRevealPhase,
  mapBidRevealStatusResponse,
  mapInvalidBidRevealDetails,
  mapValidBidRevealResponse,
} from "./bid-reveal-response.mapper";
import { BidRevealInvalidReason } from "./types/bid-reveal-invalid-reason.enum";
import type { BidRevealOperationResult } from "./types/bid-reveal-operation-result.type";
import type { BidRevealResponse } from "./types/bid-reveal-response.type";
import type { BidRevealStatusResponse } from "./types/bid-reveal-status-response.type";

const auctionSelect = {
  id: true,
  currency: true,
  startTime: true,
  revealTime: true,
  endTime: true,
  status: true,
} satisfies Prisma.AuctionSelect;

const currentCommitmentSelect = {
  id: true,
  commitmentHash: true,
  protocolVersion: true,
  committedAt: true,
} satisfies Prisma.BidCommitmentSelect;

const validRevealSelect = {
  id: true,
  amountCents: true,
  validationStatus: true,
  invalidReason: true,
  submittedAt: true,
} satisfies Prisma.BidRevealAttemptSelect;

const revealAttemptSelect = {
  id: true,
  bidId: true,
  clientRequestId: true,
  amountCents: true,
  secret: true,
  validationStatus: true,
  invalidReason: true,
  submittedAt: true,
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
} satisfies Prisma.BidRevealAttemptSelect;

const bidRevealSelect = {
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
    select: currentCommitmentSelect,
  },
  revealAttempts: {
    where: {
      validationStatus: RevealValidationStatus.VALID,
    },
    take: 1,
    select: validRevealSelect,
  },
} satisfies Prisma.BidSelect;

type AuctionRecord = Prisma.AuctionGetPayload<{ select: typeof auctionSelect }>;
type BidForReveal = Prisma.BidGetPayload<{ select: typeof bidRevealSelect }>;
type RevealAttemptWithBid = Prisma.BidRevealAttemptGetPayload<{
  select: typeof revealAttemptSelect;
}>;

@Injectable()
export class BidRevealsService {
  constructor(private readonly prisma: PrismaService) {}

  async submitReveal(
    bidderId: string,
    auctionId: string,
    dto: SubmitBidRevealDto,
  ): Promise<BidRevealResponse> {
    validateAmountCents(dto.amountCents);
    validateSecret(dto.secret);

    const result = await this.runRevealTransaction(bidderId, auctionId, dto);

    if (result.outcome === "VALID" || result.outcome === "EXISTING_VALID") {
      return result.response;
    }

    throw new UnprocessableEntityException({
      statusCode: 422,
      message: "Reveal does not match current commitment",
      error: "Unprocessable Entity",
      details: result.details,
    });
  }

  async getRevealStatus(
    bidderId: string,
    auctionId: string,
  ): Promise<BidRevealStatusResponse> {
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
      const validReveal = bid?.revealAttempts[0] ?? null;
      const invalidAttemptCount = bid
        ? await transaction.bidRevealAttempt.count({
            where: {
              bidId: bid.id,
              validationStatus: RevealValidationStatus.INVALID,
            },
          })
        : 0;

      return mapBidRevealStatusResponse({
        auction,
        bid: bid
          ? {
              id: bid.id,
              status: bid.status,
              version: bid.version,
              currentCommitment: bid.commitments[0] ?? null,
            }
          : null,
        validReveal,
        invalidAttemptCount,
        databaseNow,
      });
    });
  }

  private async runRevealTransaction(
    bidderId: string,
    auctionId: string,
    dto: SubmitBidRevealDto,
  ): Promise<BidRevealOperationResult> {
    try {
      return await serializableTransaction(this.prisma, async (transaction) => {
        const existingRequest = await transaction.bidRevealAttempt.findUnique({
          where: {
            clientRequestId: dto.clientRequestId,
          },
          select: revealAttemptSelect,
        });

        if (existingRequest) {
          return this.handleExistingRequest(
            transaction,
            existingRequest,
            bidderId,
            auctionId,
            dto,
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

        const phase = deriveRevealPhase(auction, databaseNow);
        if (auction.status !== AuctionStatus.PUBLISHED || phase !== AuctionPhase.REVEAL) {
          throw new ConflictException("Auction is not accepting reveals");
        }

        const bid = await this.findBid(transaction, auctionId, bidderId);
        if (!bid || bid.commitments.length === 0) {
          throw new ConflictException("No commitment is available for reveal");
        }

        if (bid.revealAttempts.length > 0) {
          throw new ConflictException("Bid was already revealed");
        }

        if (bid.version !== dto.expectedBidVersion) {
          throw new ConflictException("Bid version conflict");
        }

        if (bid.status !== BidStatus.COMMITTED) {
          throw new ConflictException("Bid was already revealed");
        }

        const currentCommitment = bid.commitments[0];
        try {
          validateProtocolVersion(currentCommitment.protocolVersion);
        } catch {
          throw new ConflictException("Commitment protocol is unsupported");
        }

        const computedCommitment = await computeBidCommitmentV1({
          auctionId: auction.id,
          bidderId,
          currency: auction.currency,
          amountCents: dto.amountCents,
          secret: dto.secret,
        });

        if (
          !constantTimeCommitmentHashEquals(
            computedCommitment,
            currentCommitment.commitmentHash,
          )
        ) {
          return this.createInvalidReveal(
            transaction,
            auction,
            bid,
            dto,
            databaseNow,
          );
        }

        return this.createValidReveal(
          transaction,
          auction,
          bid,
          dto,
          databaseNow,
        );
      });
    } catch (error) {
      const conflictResult = await this.mapPrismaConflict(error, bidderId, auctionId, dto);
      if (conflictResult) {
        return conflictResult;
      }

      throw error;
    }
  }

  private async createInvalidReveal(
    transaction: Prisma.TransactionClient,
    auction: AuctionRecord,
    bid: BidForReveal,
    dto: SubmitBidRevealDto,
    databaseNow: Date,
  ): Promise<BidRevealOperationResult> {
    const reveal = await transaction.bidRevealAttempt.create({
      data: {
        bidId: bid.id,
        clientRequestId: dto.clientRequestId,
        amountCents: BigInt(dto.amountCents),
        secret: dto.secret,
        validationStatus: RevealValidationStatus.INVALID,
        invalidReason: BidRevealInvalidReason.COMMITMENT_MISMATCH,
        submittedAt: databaseNow,
      },
      select: validRevealSelect,
    });

    return {
      outcome: "INVALID",
      details: mapInvalidBidRevealDetails({
        auction,
        reveal,
        databaseNow,
      }),
    };
  }

  private async createValidReveal(
    transaction: Prisma.TransactionClient,
    auction: AuctionRecord,
    bid: BidForReveal,
    dto: SubmitBidRevealDto,
    databaseNow: Date,
  ): Promise<BidRevealOperationResult> {
    const bidUpdate = await transaction.bid.updateMany({
      where: {
        id: bid.id,
        bidderId: bid.bidderId,
        status: BidStatus.COMMITTED,
        version: dto.expectedBidVersion,
      },
      data: {
        status: BidStatus.REVEALED,
        version: {
          increment: 1,
        },
      },
    });

    if (bidUpdate.count !== 1) {
      throw new ConflictException("Bid version conflict");
    }

    const reveal = await transaction.bidRevealAttempt.create({
      data: {
        bidId: bid.id,
        clientRequestId: dto.clientRequestId,
        amountCents: BigInt(dto.amountCents),
        secret: dto.secret,
        validationStatus: RevealValidationStatus.VALID,
        invalidReason: null,
        submittedAt: databaseNow,
      },
      select: validRevealSelect,
    });

    return {
      outcome: "VALID",
      response: mapValidBidRevealResponse({
        auction,
        bid: {
          id: bid.id,
          status: BidStatus.REVEALED,
          version: bid.version + 1,
        },
        reveal,
        databaseNow,
      }),
    };
  }

  private async handleExistingRequest(
    transaction: Prisma.TransactionClient,
    existingRequest: RevealAttemptWithBid,
    bidderId: string,
    auctionId: string,
    dto: SubmitBidRevealDto,
  ): Promise<BidRevealOperationResult> {
    if (
      existingRequest.bid.auctionId !== auctionId ||
      existingRequest.bid.bidderId !== bidderId ||
      existingRequest.amountCents.toString() !== dto.amountCents ||
      !constantTimeSecretEquals(existingRequest.secret, dto.secret)
    ) {
      throw new ConflictException("Reveal request identifier conflict");
    }

    const databaseNow = await getDatabaseTime(transaction);

    if (existingRequest.validationStatus === RevealValidationStatus.VALID) {
      return {
        outcome: "EXISTING_VALID",
        response: mapValidBidRevealResponse({
          auction: existingRequest.bid.auction,
          bid: {
            id: existingRequest.bid.id,
            status: existingRequest.bid.status,
            version: existingRequest.bid.version,
          },
          reveal: existingRequest,
          databaseNow,
        }),
      };
    }

    return {
      outcome: "EXISTING_INVALID",
      details: mapInvalidBidRevealDetails({
        auction: existingRequest.bid.auction,
        reveal: existingRequest,
        databaseNow,
      }),
    };
  }

  private async findBid(
    transaction: Prisma.TransactionClient,
    auctionId: string,
    bidderId: string,
  ): Promise<BidForReveal | null> {
    return transaction.bid.findUnique({
      where: {
        auctionId_bidderId: {
          auctionId,
          bidderId,
        },
      },
      select: bidRevealSelect,
    });
  }

  private async mapPrismaConflict(
    error: unknown,
    bidderId: string,
    auctionId: string,
    dto: SubmitBidRevealDto,
  ): Promise<BidRevealOperationResult | never | void> {
    if (!isPrismaKnownError(error, "P2002")) {
      return;
    }

    const target = getPrismaTarget(error);
    if (target.includes("clientRequestId")) {
      const existingRequest = await this.prisma.bidRevealAttempt.findUnique({
        where: {
          clientRequestId: dto.clientRequestId,
        },
        select: revealAttemptSelect,
      });

      if (
        existingRequest &&
        existingRequest.bid.auctionId === auctionId &&
        existingRequest.bid.bidderId === bidderId &&
        existingRequest.amountCents.toString() === dto.amountCents &&
        constantTimeSecretEquals(existingRequest.secret, dto.secret)
      ) {
        const databaseNow = await this.prisma.$transaction((transaction) =>
          getDatabaseTime(transaction),
        );
        if (existingRequest.validationStatus === RevealValidationStatus.VALID) {
          return {
            outcome: "EXISTING_VALID",
            response: mapValidBidRevealResponse({
              auction: existingRequest.bid.auction,
              bid: {
                id: existingRequest.bid.id,
                status: existingRequest.bid.status,
                version: existingRequest.bid.version,
              },
              reveal: existingRequest,
              databaseNow,
            }),
          };
        }

        return {
          outcome: "EXISTING_INVALID",
          details: mapInvalidBidRevealDetails({
            auction: existingRequest.bid.auction,
            reveal: existingRequest,
            databaseNow,
          }),
        };
      }

      throw new ConflictException("Reveal request identifier conflict");
    }

    throw new ConflictException("Bid was already revealed");
  }
}

function constantTimeSecretEquals(firstSecret: string, secondSecret: string): boolean {
  if (
    typeof firstSecret !== "string" ||
    typeof secondSecret !== "string" ||
    firstSecret.length !== secondSecret.length
  ) {
    return false;
  }

  return timingSafeEqual(Buffer.from(firstSecret), Buffer.from(secondSecret));
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
