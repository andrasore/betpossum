import { IsIn, IsInt, IsNumber, IsString, Max, Min } from "class-validator";
import { MAX_ODDS, MAX_STAKE_CENTS, MIN_ODDS } from "../../common/money";

export class PlaceBetDto {
  @IsString()
  eventId!: string;

  @IsIn(["home", "away", "draw"])
  selection!: "home" | "away" | "draw";

  // Decimal odds are a payout multiplier — profit is stake * (odds - 1), so
  // anything <= 1 is not a bet. `odds` is client-supplied and not checked
  // against the odds feed, where 0 also legitimately means "no market".
  @IsNumber()
  @Min(MIN_ODDS)
  @Max(MAX_ODDS)
  odds!: number;

  // @IsInt is what makes a sub-cent stake unrepresentable, and @Min(1) what
  // stops a stake that rounds down to a zero-cent hold.
  @IsInt()
  @Min(1)
  @Max(MAX_STAKE_CENTS)
  stakeCents!: number;
}
