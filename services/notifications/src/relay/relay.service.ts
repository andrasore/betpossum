import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { NotificationEventSchema } from "../generated/events";
import { MessagingService } from "../messaging/messaging.service";
import { RelayGateway } from "./relay.gateway";
import { SOCKET_EVENT } from "./socket-events";

export const NOTIFICATIONS_EXCHANGE = "notifications";

/**
 * Binds an exclusive auto-delete queue to the transient `notifications` fanout
 * and re-emits each envelope's inner `payload` verbatim to the target user's
 * room (or broadcasts when `userId` is empty).
 *
 * Fire-and-forget by design: messages published while this service is down are
 * dropped, which is why the exchange and queue are non-durable and `noAck`.
 */
@Injectable()
export class RelayService implements OnModuleInit {
  private readonly logger = new Logger(RelayService.name);

  constructor(
    private readonly messaging: MessagingService,
    private readonly gateway: RelayGateway,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.messaging.subscribe(NOTIFICATIONS_EXCHANGE, (raw) =>
      this.relay(raw),
    );
    this.logger.log("Notifications subscriber ready");
  }

  relay(raw: Buffer): void {
    // A malformed message must not kill the subscription — log and move on.
    try {
      const event = NotificationEventSchema.parse(JSON.parse(raw.toString()));
      const socketEvent = SOCKET_EVENT[event.kind];
      if (event.userId) {
        this.gateway.server.to(event.userId).emit(socketEvent, event.payload);
      } else {
        this.gateway.server.emit(socketEvent, event.payload);
      }
    } catch (err) {
      this.logger.error(`Failed to handle notification: ${String(err)}`);
    }
  }
}
