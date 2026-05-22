import { Controller, Get } from "@nestjs/common";
import { type AuthUser, CurrentUser } from "../common/current-user.decorator";
import { WalletService } from "./wallet.service";

@Controller()
export class WalletController {
  constructor(private readonly wallet: WalletService) {}

  @Get("wallet/balance")
  async getBalanceForCaller(@CurrentUser() user: AuthUser) {
    const balance = await this.wallet.getBalance(user.id);
    return { balance };
  }
}
