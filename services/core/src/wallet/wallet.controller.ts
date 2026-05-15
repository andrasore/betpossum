import { Body, Controller, Get, HttpCode, Param, Post, Request, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { WalletService } from './wallet.service';
import { CreateAccountDto } from './dto/create-account.dto';
import { DepositDto } from './dto/deposit.dto';

@Controller()
export class WalletController {
  constructor(private readonly wallet: WalletService) {}

  @Post('accounts')
  @HttpCode(201)
  async createAccount(@Body() dto: CreateAccountDto) {
    await this.wallet.createAccount(dto.userId);
    return { status: 'ok' };
  }

  @Get('accounts/:userId/balance')
  async getBalanceByUserId(@Param('userId') userId: string) {
    const balance = await this.wallet.getBalance(userId);
    return { user_id: userId, balance };
  }

  @Get('wallet/balance')
  @UseGuards(AuthGuard('jwt'))
  async getBalanceForCaller(@Request() req: any) {
    const balance = await this.wallet.getBalance(req.user.id);
    return { balance };
  }

  @Post('deposit')
  @HttpCode(201)
  async deposit(@Body() dto: DepositDto) {
    const amountCents = Math.round(dto.amount * 100);
    await this.wallet.deposit(dto.userId, amountCents);
    return { status: 'ok' };
  }
}
