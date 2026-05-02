import { Body, Controller, Get, Post, Request, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { BetsService } from './bets.service';
import { PlaceBetDto } from './dto/place-bet.dto';

@Controller('bets')
@UseGuards(AuthGuard('jwt'))
export class BetsController {
  constructor(private readonly bets: BetsService) {}

  @Post()
  place(@Request() req: any, @Body() dto: PlaceBetDto) {
    return this.bets.place(req.user.id, dto.eventId, dto.selection, dto.odds, dto.stake);
  }

  @Get()
  list(@Request() req: any) {
    return this.bets.findByUser(req.user.id);
  }
}
