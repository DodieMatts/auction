-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'BIDDER');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "AuctionStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'CANCELLED', 'SETTLED');

-- CreateEnum
CREATE TYPE "BidStatus" AS ENUM ('COMMITTED', 'REVEALED', 'INVALID', 'WON', 'LOST');

-- CreateEnum
CREATE TYPE "RevealValidationStatus" AS ENUM ('PENDING', 'VALID', 'INVALID');

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "email" VARCHAR(320) NOT NULL,
    "passwordHash" VARCHAR(255) NOT NULL,
    "role" "UserRole" NOT NULL,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Auction" (
    "id" UUID NOT NULL,
    "creationRequestId" UUID NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "description" TEXT,
    "currency" CHAR(3) NOT NULL,
    "startTime" TIMESTAMPTZ(6) NOT NULL,
    "revealTime" TIMESTAMPTZ(6) NOT NULL,
    "endTime" TIMESTAMPTZ(6) NOT NULL,
    "status" "AuctionStatus" NOT NULL DEFAULT 'DRAFT',
    "createdById" UUID NOT NULL,
    "settlementRequestId" UUID,
    "cancellationRequestId" UUID,
    "settledAt" TIMESTAMPTZ(6),
    "cancelledAt" TIMESTAMPTZ(6),
    "cancellationReason" VARCHAR(500),
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "Auction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Bid" (
    "id" UUID NOT NULL,
    "auctionId" UUID NOT NULL,
    "bidderId" UUID NOT NULL,
    "status" "BidStatus" NOT NULL DEFAULT 'COMMITTED',
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "Bid_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BidCommitment" (
    "id" UUID NOT NULL,
    "bidId" UUID NOT NULL,
    "clientRequestId" UUID NOT NULL,
    "commitmentHash" CHAR(64) NOT NULL,
    "protocolVersion" INTEGER NOT NULL DEFAULT 1,
    "isCurrent" BOOLEAN NOT NULL DEFAULT true,
    "committedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "replacedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BidCommitment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BidRevealAttempt" (
    "id" UUID NOT NULL,
    "bidId" UUID NOT NULL,
    "clientRequestId" UUID NOT NULL,
    "amountCents" BIGINT NOT NULL,
    "secret" VARCHAR(512) NOT NULL,
    "validationStatus" "RevealValidationStatus" NOT NULL DEFAULT 'PENDING',
    "invalidReason" VARCHAR(255),
    "submittedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BidRevealAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_role_status_idx" ON "User"("role", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Auction_creationRequestId_key" ON "Auction"("creationRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "Auction_settlementRequestId_key" ON "Auction"("settlementRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "Auction_cancellationRequestId_key" ON "Auction"("cancellationRequestId");

-- CreateIndex
CREATE INDEX "Auction_createdById_idx" ON "Auction"("createdById");

-- CreateIndex
CREATE INDEX "Auction_status_startTime_idx" ON "Auction"("status", "startTime");

-- CreateIndex
CREATE INDEX "Auction_status_revealTime_idx" ON "Auction"("status", "revealTime");

-- CreateIndex
CREATE INDEX "Auction_status_endTime_idx" ON "Auction"("status", "endTime");

-- CreateIndex
CREATE INDEX "Bid_auctionId_status_idx" ON "Bid"("auctionId", "status");

-- CreateIndex
CREATE INDEX "Bid_bidderId_idx" ON "Bid"("bidderId");

-- CreateIndex
CREATE UNIQUE INDEX "Bid_auctionId_bidderId_key" ON "Bid"("auctionId", "bidderId");

-- CreateIndex
CREATE UNIQUE INDEX "BidCommitment_clientRequestId_key" ON "BidCommitment"("clientRequestId");

-- CreateIndex
CREATE INDEX "BidCommitment_bidId_committedAt_idx" ON "BidCommitment"("bidId", "committedAt");

-- CreateIndex
CREATE UNIQUE INDEX "BidCommitment_bidId_commitmentHash_key" ON "BidCommitment"("bidId", "commitmentHash");

-- CreateIndex
CREATE UNIQUE INDEX "BidRevealAttempt_clientRequestId_key" ON "BidRevealAttempt"("clientRequestId");

-- CreateIndex
CREATE INDEX "BidRevealAttempt_bidId_submittedAt_idx" ON "BidRevealAttempt"("bidId", "submittedAt");

-- CreateIndex
CREATE INDEX "BidRevealAttempt_bidId_validationStatus_idx" ON "BidRevealAttempt"("bidId", "validationStatus");

-- AddForeignKey
ALTER TABLE "Auction" ADD CONSTRAINT "Auction_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bid" ADD CONSTRAINT "Bid_auctionId_fkey" FOREIGN KEY ("auctionId") REFERENCES "Auction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bid" ADD CONSTRAINT "Bid_bidderId_fkey" FOREIGN KEY ("bidderId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BidCommitment" ADD CONSTRAINT "BidCommitment_bidId_fkey" FOREIGN KEY ("bidId") REFERENCES "Bid"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BidRevealAttempt" ADD CONSTRAINT "BidRevealAttempt_bidId_fkey" FOREIGN KEY ("bidId") REFERENCES "Bid"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CustomCheckConstraint
ALTER TABLE "User"
ADD CONSTRAINT "User_email_normalized_check"
CHECK (
  "email" = LOWER(BTRIM("email"))
  AND CHAR_LENGTH(BTRIM("email")) > 0
);

-- CustomCheckConstraint
ALTER TABLE "User"
ADD CONSTRAINT "User_passwordHash_not_empty_check"
CHECK (CHAR_LENGTH(BTRIM("passwordHash")) > 0);

-- CustomCheckConstraint
ALTER TABLE "Auction"
ADD CONSTRAINT "Auction_title_not_empty_check"
CHECK (CHAR_LENGTH(BTRIM("title")) > 0);

-- CustomCheckConstraint
ALTER TABLE "Auction"
ADD CONSTRAINT "Auction_currency_format_check"
CHECK ("currency" ~ '^[A-Z]{3}$');

-- CustomCheckConstraint
ALTER TABLE "Auction"
ADD CONSTRAINT "Auction_time_order_check"
CHECK (
  "startTime" < "revealTime"
  AND "revealTime" < "endTime"
);

-- CustomCheckConstraint
ALTER TABLE "Auction"
ADD CONSTRAINT "Auction_version_nonnegative_check"
CHECK ("version" >= 0);

-- CustomCheckConstraint
ALTER TABLE "Auction"
ADD CONSTRAINT "Auction_settlement_state_check"
CHECK (
  ("status" = 'SETTLED') = ("settledAt" IS NOT NULL)
);

-- CustomCheckConstraint
ALTER TABLE "Auction"
ADD CONSTRAINT "Auction_cancellation_state_check"
CHECK (
  ("status" = 'CANCELLED') = ("cancelledAt" IS NOT NULL)
);

-- CustomCheckConstraint
ALTER TABLE "Auction"
ADD CONSTRAINT "Auction_settlement_request_check"
CHECK (
  "settlementRequestId" IS NULL
  OR "status" = 'SETTLED'
);

-- CustomCheckConstraint
ALTER TABLE "Auction"
ADD CONSTRAINT "Auction_cancellation_request_check"
CHECK (
  "cancellationRequestId" IS NULL
  OR "status" = 'CANCELLED'
);

-- CustomCheckConstraint
ALTER TABLE "Auction"
ADD CONSTRAINT "Auction_cancellation_reason_check"
CHECK (
  "cancellationReason" IS NULL
  OR CHAR_LENGTH(BTRIM("cancellationReason")) > 0
);

-- CustomCheckConstraint
ALTER TABLE "Bid"
ADD CONSTRAINT "Bid_version_nonnegative_check"
CHECK ("version" >= 0);

-- CustomCheckConstraint
ALTER TABLE "BidCommitment"
ADD CONSTRAINT "BidCommitment_hash_format_check"
CHECK ("commitmentHash" ~ '^[0-9a-f]{64}$');

-- CustomCheckConstraint
ALTER TABLE "BidCommitment"
ADD CONSTRAINT "BidCommitment_protocol_version_check"
CHECK ("protocolVersion" > 0);

-- CustomCheckConstraint
ALTER TABLE "BidCommitment"
ADD CONSTRAINT "BidCommitment_replacement_state_check"
CHECK (
  ("isCurrent" = TRUE AND "replacedAt" IS NULL)
  OR
  ("isCurrent" = FALSE AND "replacedAt" IS NOT NULL)
);

-- CustomCheckConstraint
ALTER TABLE "BidRevealAttempt"
ADD CONSTRAINT "BidRevealAttempt_amount_positive_check"
CHECK ("amountCents" > 0);

-- CustomCheckConstraint
ALTER TABLE "BidRevealAttempt"
ADD CONSTRAINT "BidRevealAttempt_secret_not_empty_check"
CHECK (CHAR_LENGTH(BTRIM("secret")) > 0);

-- CustomCheckConstraint
ALTER TABLE "BidRevealAttempt"
ADD CONSTRAINT "BidRevealAttempt_validation_state_check"
CHECK (
  (
    "validationStatus" = 'INVALID'
    AND "invalidReason" IS NOT NULL
    AND CHAR_LENGTH(BTRIM("invalidReason")) > 0
  )
  OR
  (
    "validationStatus" IN ('PENDING', 'VALID')
    AND "invalidReason" IS NULL
  )
);

-- CustomPartialUniqueIndex
CREATE UNIQUE INDEX "BidCommitment_one_current_per_bid"
ON "BidCommitment" ("bidId")
WHERE "isCurrent" = TRUE;

-- CustomPartialUniqueIndex
CREATE UNIQUE INDEX "BidRevealAttempt_one_valid_per_bid"
ON "BidRevealAttempt" ("bidId")
WHERE "validationStatus" = 'VALID';

-- CustomPartialUniqueIndex
CREATE UNIQUE INDEX "Bid_one_winner_per_auction"
ON "Bid" ("auctionId")
WHERE "status" = 'WON';
