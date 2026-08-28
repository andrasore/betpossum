import { Controller, Get, Inject } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Public } from "../common/public.decorator";
import type { OddsProvider } from "../providers/base";
import { ODDS_PROVIDERS } from "../providers/providers.module";

@Controller("health")
export class HealthController {
  constructor(
    @Inject(ODDS_PROVIDERS) private readonly providers: OddsProvider[],
    private readonly config: ConfigService,
  ) {}

  // Public: this is the container healthcheck endpoint, which carries no token.
  @Public()
  @Get()
  health() {
    return {
      status: "ok",
      providers: this.providers.map((p) => p.name),
      storage: this.config.get<string>("ODDS_STORAGE", "postgres"),
    };
  }
}
