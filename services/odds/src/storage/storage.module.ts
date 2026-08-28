import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { DataSource } from "typeorm";
import { OddsStorage } from "./odds-storage";
import { PostgresStorage } from "./postgres.storage";

// Nest's container is what makes one storage instance shared by the HTTP layer
// and the poll runner — the Python service needed a module-global for this.
@Module({
  providers: [
    {
      provide: OddsStorage,
      inject: [ConfigService, DataSource],
      useFactory: (
        config: ConfigService,
        dataSource: DataSource,
      ): OddsStorage => {
        const name = config.get<string>("ODDS_STORAGE", "postgres");
        if (name === "postgres") {
          return new PostgresStorage(dataSource);
        }
        throw new Error(
          `Unknown ODDS_STORAGE=${name}; expected one of: postgres`,
        );
      },
    },
  ],
  exports: [OddsStorage],
})
export class StorageModule {}
