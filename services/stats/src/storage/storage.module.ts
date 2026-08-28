import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { getRepositoryToken, TypeOrmModule } from "@nestjs/typeorm";
import type { Repository } from "typeorm";
import { PostgresStorage } from "./postgres.storage";
import { Settlement } from "./settlement.entity";
import { StatsStorage } from "./stats-storage";

// Nest's container is what makes one storage instance shared by the HTTP layer
// and the consumer — the Python service needed a module-global for this.
@Module({
  imports: [TypeOrmModule.forFeature([Settlement])],
  providers: [
    {
      provide: StatsStorage,
      inject: [ConfigService, getRepositoryToken(Settlement)],
      useFactory: (
        config: ConfigService,
        repo: Repository<Settlement>,
      ): StatsStorage => {
        const name = config.get<string>("STATS_STORAGE", "postgres");
        if (name === "postgres") {
          return new PostgresStorage(repo);
        }
        throw new Error(
          `Unknown STATS_STORAGE=${name}; expected one of: postgres`,
        );
      },
    },
  ],
  exports: [StatsStorage],
})
export class StorageModule {}
