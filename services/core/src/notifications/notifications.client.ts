import { Injectable } from "@nestjs/common";
import {
  type NotificationEvent,
  NotificationEventSchema,
} from "../generated/events";
import { MessagingService } from "../messaging/messaging.service";

const CHANNEL = "notifications";

@Injectable()
export class NotificationsClient {
  constructor(private readonly messaging: MessagingService) {}

  betHeld(userId: string, betId: string): Promise<void> {
    return this.publish({ userId, kind: "betHeld", payload: { betId } });
  }

  betSettled(
    userId: string,
    betId: string,
    won: boolean,
    payout: number,
  ): Promise<void> {
    return this.publish({
      userId,
      kind: "betSettled",
      payload: { betId, won, payout },
    });
  }

  balanceUpdated(userId: string, balance: number): Promise<void> {
    return this.publish({
      userId,
      kind: "balanceUpdated",
      payload: { balance },
    });
  }

  private async publish(message: NotificationEvent): Promise<void> {
    const msg = NotificationEventSchema.parse(message);
    await this.messaging.publish(CHANNEL, Buffer.from(JSON.stringify(msg)));
  }
}
