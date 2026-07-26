import { COMMITMENT_PROTOCOL_VERSION } from "@auction/commitment";
import { Transform } from "class-transformer";
import { Equals, IsInt, IsOptional, IsString, IsUUID, Matches, Min } from "class-validator";

export class SubmitBidCommitmentDto {
  @IsUUID("4")
  clientRequestId!: string;

  @Transform(({ value }: { value: unknown }) =>
    typeof value === "string" ? value.trim() : value,
  )
  @IsString()
  @Matches(/^[0-9a-f]{64}$/)
  commitmentHash!: string;

  @IsInt()
  @Equals(COMMITMENT_PROTOCOL_VERSION)
  protocolVersion!: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  expectedBidVersion?: number;
}
