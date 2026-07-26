import { Transform } from "class-transformer";
import { IsInt, IsString, IsUUID, Max, MaxLength, Min, MinLength } from "class-validator";

export class CancelAuctionDto {
  @IsUUID("4")
  cancellationRequestId!: string;

  @IsInt()
  @Min(0)
  @Max(Number.MAX_SAFE_INTEGER)
  expectedVersion!: number;

  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  reason!: string;
}
