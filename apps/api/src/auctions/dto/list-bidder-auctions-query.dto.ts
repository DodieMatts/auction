import { Transform } from "class-transformer";
import { IsInt, Max, Min } from "class-validator";

function toNumberWithDefault(defaultValue: number) {
  return ({ value }: { value: unknown }) => {
    if (value === undefined || value === null || value === "") {
      return defaultValue;
    }

    return Number(value);
  };
}

export class ListBidderAuctionsQueryDto {
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
