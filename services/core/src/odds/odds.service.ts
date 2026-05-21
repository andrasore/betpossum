import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import type { Repository } from "typeorm";
import { OddsUpdatedEvent } from "../generated/events";
import { MessagingService } from "../messaging/messaging.service";
import { NotificationsClient } from "../notifications/notifications.client";
import { OddsCurrent } from "./odds-current.entity";

@Injectable()
export class OddsService implements OnModuleInit {
  private readonly logger = new Logger(OddsService.name);

  constructor(
    private readonly messaging: MessagingService,
    private readonly notifications: NotificationsClient,
    @InjectRepository(OddsCurrent)
    private readonly repo: Repository<OddsCurrent>,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.messaging.subscribe("odds.updated", async (raw) => {
      try {
        const event = OddsUpdatedEvent.fromBinary(raw);
        await this.notifications.broadcast("odds.updated", event);
      } catch (e) {
        this.logger.error("Failed to decode odds.updated", e);
      }
    });
  }

  getOdds(eventId: string): Promise<OddsCurrent | null> {
    return this.repo.findOneBy({ eventId });
  }

  listOdds(sport?: string): Promise<OddsCurrent[]> {
    return this.repo.find({
      where: sport ? { sport } : {},
      order: { updatedAt: "DESC" },
    });
  }
}
