import { Controller, Get, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { WalletService } from './wallet.service';
import { AuthUser, CurrentUser } from '../common/current-user.decorator';

@Controller()
export class WalletController {
  constructor(private readonly wallet: WalletService) {}

  @Get('wallet/balance')
  @UseGuards(AuthGuard('jwt'))
  async getBalanceForCaller(@CurrentUser() user: AuthUser) {
    const balance = await this.wallet.getBalance(user.id);
    return { balance };
  }
}
