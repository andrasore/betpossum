import { Body, Controller, Get, Post } from "@nestjs/common";
import { type AuthUser, CurrentUser } from "../common/current-user.decorator";
import { BetsService } from "./bets.service";
import { PlaceBetDto } from "./dto/place-bet.dto";

@Controller("bets")
export class BetsController {
  constructor(private readonly bets: BetsService) {}

  @Post()
  place(@CurrentUser() user: AuthUser, @Body() dto: PlaceBetDto) {
    return this.bets.place(
      user.id,
      dto.eventId,
      dto.selection,
      dto.odds,
      dto.stake,
    );
  }

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.bets.findByUser(user.id);
  }
}
