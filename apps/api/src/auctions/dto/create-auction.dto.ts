import { Transform } from "class-transformer";
import {
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from "class-validator";

const timezonePattern = /(Z|[+-]\d{2}:\d{2})$/;

export class CreateAuctionDto {
  @IsUUID("4")
  creationRequestId!: string;

  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title!: string;

  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string | null;

  @Transform(({ value }) =>
    typeof value === "string" ? value.trim().toUpperCase() : value,
  )
  @IsString()
  @Matches(/^[A-Z]{3}$/)
  currency!: string;

  @IsString()
  @IsISO8601({ strict: true, strictSeparator: true })
  @Matches(timezonePattern)
  startTime!: string;

  @IsString()
  @IsISO8601({ strict: true, strictSeparator: true })
  @Matches(timezonePattern)
  revealTime!: string;

  @IsString()
  @IsISO8601({ strict: true, strictSeparator: true })
  @Matches(timezonePattern)
  endTime!: string;
}
