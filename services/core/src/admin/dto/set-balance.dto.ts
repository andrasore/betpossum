import { IsInt, Max, Min } from "class-validator";
import { MAX_STAKE_CENTS } from "../../common/money";

export class SetBalanceDto {
  @IsInt()
  @Min(0)
  @Max(MAX_STAKE_CENTS)
  amountCents!: number;
}
