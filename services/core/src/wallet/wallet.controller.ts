import { Controller, Get } from "@nestjs/common";
import { type AuthUser, CurrentUser } from "../common/current-user.decorator";
import { WalletService } from "./wallet.service";

@Controller()
export class WalletController {
  constructor(private readonly wallet: WalletService) {}

  @Get("wallet/balance")
  async getBalanceForCaller(@CurrentUser() user: AuthUser) {
    const balanceCents = await this.wallet.getBalanceCents(user.id);
    return { balanceCents };
  }
}
