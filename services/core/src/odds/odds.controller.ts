import { Controller, Get, Param, Query, UseGuards } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { OddsService } from "./odds.service";

@Controller("odds")
@UseGuards(AuthGuard("jwt"))
export class OddsController {
  constructor(private readonly odds: OddsService) {}

  @Get()
  list(@Query("sport") sport?: string) {
    return this.odds.listOdds(sport);
  }

  @Get(":eventId")
  getOne(@Param("eventId") eventId: string) {
    return this.odds.getOdds(eventId);
  }
}
