import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ApiFootballProvider } from "./apifootball.provider";
import { OddsProvider } from "./base";
import { MockProvider } from "./mock.provider";
import { TheOddsApiProvider } from "./theoddsapi.provider";

export const ODDS_PROVIDERS = "ODDS_PROVIDERS";

export function getProvider(name: string): OddsProvider {
  if (name === "theoddsapi") {
    return TheOddsApiProvider.fromEnv();
  }
  if (name === "apifootball") {
    return ApiFootballProvider.fromEnv();
  }
  if (name === "mock") {
    return new MockProvider();
  }
  throw new Error(
    `Unknown odds provider ${name}; expected one of: theoddsapi, apifootball, mock`,
  );
}

/** Instantiate every enabled provider; they run concurrently at runtime. */
export function getProviders(names: string[]): OddsProvider[] {
  return names.map(getProvider);
}

@Module({
  providers: [
    {
      provide: ODDS_PROVIDERS,
      inject: [ConfigService],
      useFactory: (config: ConfigService): OddsProvider[] => {
        // Comma-separated; every enabled provider runs its own poll loop.
        const names = config
          .get<string>("ODDS_PROVIDERS", "mock")
          .split(",")
          .map((n) => n.trim())
          .filter(Boolean);
        return getProviders(names);
      },
    },
  ],
  exports: [ODDS_PROVIDERS],
})
export class ProvidersModule {}
