import { Injectable } from "@nestjs/common";
import { NotificationEvent } from "../generated/events";
import { MessagingService } from "../messaging/messaging.service";

const CHANNEL = "notifications";

@Injectable()
export class NotificationsClient {
  constructor(private readonly messaging: MessagingService) {}

  toUser(userId: string, event: string, data: unknown): Promise<void> {
    return this.publish(userId, event, data);
  }

  broadcast(event: string, data: unknown): Promise<void> {
    return this.publish("", event, data);
  }

  private async publish(
    userId: string,
    event: string,
    data: unknown,
  ): Promise<void> {
    const msg = NotificationEvent.create({
      userId,
      event,
      payload: JSON.stringify(data),
    });
    await this.messaging.publish(
      CHANNEL,
      Buffer.from(NotificationEvent.toBinary(msg)),
    );
  }
}
