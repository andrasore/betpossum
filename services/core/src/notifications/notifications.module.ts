import { Module } from "@nestjs/common";
import { MessagingModule } from "../messaging/messaging.module";
import { NotificationsClient } from "./notifications.client";

@Module({
  imports: [MessagingModule],
  providers: [NotificationsClient],
  exports: [NotificationsClient],
})
export class NotificationsModule {}
