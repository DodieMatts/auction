import { IsInt, Max, Min } from "class-validator";

export class PublishAuctionDto {
  @IsInt()
  @Min(0)
  @Max(Number.MAX_SAFE_INTEGER)
  expectedVersion!: number;
}
