import { Transform } from "class-transformer";
import { IsEnum, IsInt, IsOptional, Max, Min } from "class-validator";

import { AuctionStatus } from "../../generated/prisma/enums";

function toNumberWithDefault(defaultValue: number) {
  return ({ value }: { value: unknown }) => {
    if (value === undefined || value === null || value === "") {
      return defaultValue;
    }

    return Number(value);
  };
}

export class ListAuctionsQueryDto {
  @IsOptional()
  @IsEnum(AuctionStatus)
  status?: AuctionStatus;

  @Transform(toNumberWithDefault(1))
  @IsInt()
  @Min(1)
  @Max(100000)
  page = 1;

  @Transform(toNumberWithDefault(20))
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;
}
