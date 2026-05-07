import { Controller, Get, Request, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { WalletService } from './wallet.service';

@Controller('wallet')
@UseGuards(AuthGuard('jwt'))
export class WalletController {
  constructor(private readonly wallet: WalletService) {}

  @Get('balance')
  async getBalance(@Request() req: any) {
    const balance = await this.wallet.getBalance(req.user.id);
    return { balance };
  }
}
