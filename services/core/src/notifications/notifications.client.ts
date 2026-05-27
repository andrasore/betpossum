import { Injectable } from "@nestjs/common";
import { NotificationEvent, type OddsUpdatedEvent } from "../generated/events";
import { MessagingService } from "../messaging/messaging.service";

const CHANNEL = "notifications";

@Injectable()
export class NotificationsClient {
  constructor(private readonly messaging: MessagingService) {}

  betHeld(userId: string, betId: string): Promise<void> {
    return this.publish({
      userId,
      body: { oneofKind: "betHeld", betHeld: { betId } },
    });
  }

  betSettled(
    userId: string,
    betId: string,
    won: boolean,
    payout: number,
  ): Promise<void> {
    return this.publish({
      userId,
      body: { oneofKind: "betSettled", betSettled: { betId, won, payout } },
    });
  }

  balanceUpdated(userId: string, balance: number): Promise<void> {
    return this.publish({
      userId,
      body: { oneofKind: "balanceUpdated", balanceUpdated: { balance } },
    });
  }

  insufficientBalance(
    userId: string,
    stake: number,
    balance: number,
  ): Promise<void> {
    return this.publish({
      userId,
      body: {
        oneofKind: "insufficientBalance",
        insufficientBalance: { stake, balance },
      },
    });
  }

  oddsUpdated(event: OddsUpdatedEvent): Promise<void> {
    return this.publish({
      userId: "",
      body: { oneofKind: "oddsUpdated", oddsUpdated: event },
    });
  }

  private async publish(message: NotificationEvent): Promise<void> {
    const msg = NotificationEvent.create(message);
    await this.messaging.publish(
      CHANNEL,
      Buffer.from(NotificationEvent.toBinary(msg)),
    );
  }
}
