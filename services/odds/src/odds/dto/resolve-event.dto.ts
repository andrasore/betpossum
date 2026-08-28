import { IsIn } from "class-validator";
import type { Outcome } from "../models";

export class ResolveEventDto {
  @IsIn(["home", "away", "draw"])
  outcome!: Outcome;
}
