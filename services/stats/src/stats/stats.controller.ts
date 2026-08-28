import { Controller, Get } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { type AuthUser, CurrentUser } from "../common/current-user.decorator";
import { Public } from "../common/public.decorator";
import type { LeaderboardEntry } from "../storage/stats-storage";
import { StatsStorage } from "../storage/stats-storage";
import {
  cumulativeRoiSeries,
  type PnlPoint,
  type Summary,
  summarise,
} from "./aggregate";

@Controller("stats")
export class StatsController {
  private readonly leaderboardLimit: number;
  private readonly leaderboardMinSettled: number;

  constructor(
    private readonly store: StatsStorage,
    config: ConfigService,
  ) {
    // Read once at startup, not per request — same as the Python module-level
    // constants these replace.
    this.leaderboardLimit = Number(
      config.get<string>("LEADERBOARD_LIMIT", "7"),
    );
    this.leaderboardMinSettled = Number(
      config.get<string>("LEADERBOARD_MIN_SETTLED", "3"),
    );
  }

  @Get("me/pnl")
  async myPnl(@CurrentUser() user: AuthUser): Promise<PnlPoint[]> {
    return cumulativeRoiSeries(await this.store.userRows(user.sub));
  }

  @Get("me/summary")
  async mySummary(@CurrentUser() user: AuthUser): Promise<Summary> {
    return summarise(await this.store.userRows(user.sub));
  }

  @Public()
  @Get("leaderboard")
  async leaderboard(): Promise<LeaderboardEntry[]> {
    return this.store.leaderboard({
      minSettled: this.leaderboardMinSettled,
      limit: this.leaderboardLimit,
    });
  }
}
