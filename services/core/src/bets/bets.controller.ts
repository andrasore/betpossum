import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { BetsService } from './bets.service';
import { PlaceBetDto } from './dto/place-bet.dto';
import { AuthUser, CurrentUser } from '../common/current-user.decorator';

@Controller('bets')
@UseGuards(AuthGuard('jwt'))
export class BetsController {
  constructor(private readonly bets: BetsService) {}

  @Post()
  place(@CurrentUser() user: AuthUser, @Body() dto: PlaceBetDto) {
    return this.bets.place(user.id, dto.eventId, dto.selection, dto.odds, dto.stake);
  }

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.bets.findByUser(user.id);
  }
}
