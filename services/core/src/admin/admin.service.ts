import { Injectable, Logger } from "@nestjs/common";
import { EventResolvedEvent, Outcome } from "../generated/events";
import { MessagingService } from "../messaging/messaging.service";
import { UsersService } from "../users/users.service";
import { WalletService } from "../wallet/wallet.service";

export interface AdminUserRow {
  id: string;
  email: string | null;
  name: string | null;
  betCount: number;
  balance: number;
}

const OUTCOME_TO_PROTO: Record<"home" | "away" | "draw", Outcome> = {
  home: Outcome.HOME,
  away: Outcome.AWAY,
  draw: Outcome.DRAW,
};

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    private readonly users: UsersService,
    private readonly wallet: WalletService,
    private readonly messaging: MessagingService,
  ) {}

  async listUsers(): Promise<AdminUserRow[]> {
    const rows = await this.users.listWithBetCounts();
    return Promise.all(
      rows.map(async ({ user, betCount }) => ({
        id: user.id,
        email: user.email,
        name: user.name,
        betCount,
        balance: await this.wallet.getBalance(user.id),
      })),
    );
  }

  async setUserBalance(userId: string, amount: number): Promise<void> {
    const targetCents = Math.round(amount * 100);
    this.logger.log(
      `Admin setting balance for ${userId} to ${targetCents} cents`,
    );
    await this.wallet.setBalance(userId, targetCents);
  }

  async resolveEvent(
    eventId: string,
    outcome: "home" | "away" | "draw",
  ): Promise<void> {
    this.logger.log(`Admin resolving event ${eventId} as ${outcome}`);
    const msg = EventResolvedEvent.create({
      eventId,
      sport: "",
      outcome: OUTCOME_TO_PROTO[outcome],
      resolvedAt: Date.now(),
    });
    await this.messaging.publish(
      "events.resolved",
      Buffer.from(EventResolvedEvent.toBinary(msg)),
      { durable: true },
    );
  }
}
