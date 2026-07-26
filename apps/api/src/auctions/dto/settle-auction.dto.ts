import { IsInt, IsUUID, Min } from "class-validator";

export class SettleAuctionDto {
  @IsUUID("4")
  settlementRequestId!: string;

  @IsInt()
  @Min(0)
  expectedVersion!: number;
}
