import { Module } from "@nestjs/common";
import { ProvidersModule } from "../providers/providers.module";
import { PublisherModule } from "../publisher/publisher.module";
import { StorageModule } from "../storage/storage.module";
import { RunnerService } from "./runner.service";

@Module({
  imports: [ProvidersModule, PublisherModule, StorageModule],
  providers: [RunnerService],
})
export class RunnerModule {}
