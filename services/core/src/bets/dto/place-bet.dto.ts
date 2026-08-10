import { IsIn, IsInt, IsString, Max, Min } from "class-validator";
import { MAX_STAKE_CENTS } from "../../common/money";

// No `odds` field: the price is the server's to decide. `place()` stamps the
// line from `OddsCacheService`, so a client-supplied one would be either
// ignored or an attack surface. The global ValidationPipe runs with
// `whitelist: true` and no `forbidNonWhitelisted`, so an older frontend still
// sending `odds` has it stripped rather than rejected.
export class PlaceBetDto {
  @IsString()
  eventId!: string;

  @IsIn(["home", "away", "draw"])
  selection!: "home" | "away" | "draw";

  // @IsInt is what makes a sub-cent stake unrepresentable, and @Min(1) what
  // stops a stake that rounds down to a zero-cent hold.
  @IsInt()
  @Min(1)
  @Max(MAX_STAKE_CENTS)
  stakeCents!: number;
}
