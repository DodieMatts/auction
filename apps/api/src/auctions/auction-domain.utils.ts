import { BadRequestException } from "@nestjs/common";

import { AuctionStatus } from "../generated/prisma/enums";
import { AuctionPhase } from "./types/auction-phase.enum";

type AuctionSchedule = {
  startTime: Date;
  revealTime: Date;
  endTime: Date;
};

export type NormalizedAuctionCreateInput = AuctionSchedule & {
  createdById: string;
  title: string;
  description: string | null;
  currency: string;
};

export type ComparableAuction = NormalizedAuctionCreateInput;

export function normalizeTitle(title: string): string {
  const normalizedTitle = title.trim();

  if (normalizedTitle.length === 0) {
    throw new BadRequestException("Title is required");
  }

  if (normalizedTitle.length > 200) {
    throw new BadRequestException("Title must be at most 200 characters");
  }

  return normalizedTitle;
}

export function normalizeDescription(
  description: string | null | undefined,
): string | null {
  if (description === null || description === undefined) {
    return null;
  }

  const normalizedDescription = description.trim();

  if (normalizedDescription.length === 0) {
    return null;
  }

  if (normalizedDescription.length > 5000) {
    throw new BadRequestException("Description must be at most 5000 characters");
  }

  return normalizedDescription;
}

export function normalizeCurrency(currency: string): string {
  const normalizedCurrency = currency.trim().toUpperCase();

  if (!/^[A-Z]{3}$/.test(normalizedCurrency)) {
    throw new BadRequestException("Currency must be a three-letter code");
  }

  return normalizedCurrency;
}

export function parseAuctionDate(value: string): Date {
  const parsedDate = new Date(value);

  if (Number.isNaN(parsedDate.getTime())) {
    throw new BadRequestException("Timestamp must be a valid ISO-8601 value");
  }

  return parsedDate;
}

export function validateAuctionSchedule(
  schedule: AuctionSchedule,
  databaseNow: Date,
): void {
  if (schedule.startTime.getTime() <= databaseNow.getTime()) {
    throw new BadRequestException("Auction start time must be in the future");
  }

  if (schedule.startTime.getTime() >= schedule.revealTime.getTime()) {
    throw new BadRequestException("Auction start time must be before reveal time");
  }

  if (schedule.revealTime.getTime() >= schedule.endTime.getTime()) {
    throw new BadRequestException("Auction reveal time must be before end time");
  }
}

export function deriveAuctionPhase(input: {
  status: AuctionStatus;
  startTime: Date;
  revealTime: Date;
  endTime: Date;
  databaseNow: Date;
}): AuctionPhase {
  if (input.status === AuctionStatus.CANCELLED) {
    return AuctionPhase.CANCELLED;
  }

  if (input.status === AuctionStatus.SETTLED) {
    return AuctionPhase.SETTLED;
  }

  if (input.status === AuctionStatus.DRAFT) {
    return AuctionPhase.DRAFT;
  }

  const now = input.databaseNow.getTime();

  if (now < input.startTime.getTime()) {
    return AuctionPhase.SCHEDULED;
  }

  if (now >= input.startTime.getTime() && now < input.revealTime.getTime()) {
    return AuctionPhase.COMMIT;
  }

  if (now >= input.revealTime.getTime() && now < input.endTime.getTime()) {
    return AuctionPhase.REVEAL;
  }

  return AuctionPhase.ENDED;
}

export function auctionCreateInputMatches(
  existingAuction: ComparableAuction,
  normalizedInput: NormalizedAuctionCreateInput,
): boolean {
  return (
    existingAuction.createdById === normalizedInput.createdById &&
    existingAuction.title === normalizedInput.title &&
    existingAuction.description === normalizedInput.description &&
    existingAuction.currency === normalizedInput.currency &&
    existingAuction.startTime.getTime() === normalizedInput.startTime.getTime() &&
    existingAuction.revealTime.getTime() === normalizedInput.revealTime.getTime() &&
    existingAuction.endTime.getTime() === normalizedInput.endTime.getTime()
  );
}
