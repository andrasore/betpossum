import { Controller, Get, Param, Query } from "@nestjs/common";
import { Public } from "../common/public.decorator";
import { OddsService } from "./odds.service";

@Controller("odds")
export class OddsController {
  constructor(private readonly odds: OddsService) {}

  @Get()
  @Public()
  list(@Query("sport") sport?: string) {
    return this.odds.listOdds(sport);
  }

  @Get(":eventId")
  @Public()
  getOne(@Param("eventId") eventId: string) {
    return this.odds.getOdds(eventId);
  }
}
