import { ValidateBy, ValidationOptions } from "class-validator";
import { IsInt, IsString, IsUUID, Matches, Min } from "class-validator";

const maxPostgresBigInt = BigInt("9223372036854775807");
const amountCentsPattern = /^[1-9][0-9]*$/;

function IsPostgresBigIntString(validationOptions?: ValidationOptions) {
  return ValidateBy(
    {
      name: "isPostgresBigIntString",
      validator: {
        validate(value: unknown): boolean {
          if (typeof value !== "string" || !amountCentsPattern.test(value)) {
            return false;
          }

          return BigInt(value) <= maxPostgresBigInt;
        },
      },
    },
    validationOptions,
  );
}

export class SubmitBidRevealDto {
  @IsUUID("4")
  clientRequestId!: string;

  @IsString()
  @IsPostgresBigIntString({
    message: "amountCents must be a positive integer-cent string within database range",
  })
  amountCents!: string;

  @IsString()
  @Matches(/^[A-Za-z0-9_-]{43}$/)
  secret!: string;

  @IsInt()
  @Min(0)
  expectedBidVersion!: number;
}
