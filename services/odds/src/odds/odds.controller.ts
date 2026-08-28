import {
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { Public } from "../common/public.decorator";
import { Roles } from "../common/roles.decorator";
import { RolesGuard } from "../common/roles.guard";
import { OddsPublisher } from "../publisher/odds.publisher";
import { OddsStorage } from "../storage/odds-storage";
import { ResolveEventDto } from "./dto/resolve-event.dto";
import { eventToResponse, leagueToResponse, sportToResponse } from "./mappers";
import type { EventResult } from "./models";

// Route order matters exactly as it did in FastAPI: `/sports` and `/leagues`
// must be declared before `/:eventId`, or they are swallowed as event lookups
// and 404. Two specs guard this.
@Controller("odds")
export class OddsController {
  constructor(
    private readonly storage: OddsStorage,
    private readonly publisher: OddsPublisher,
  ) {}

  @Public()
  @Get("sports")
  async listSports() {
    const sports = await this.storage.listSports();
    return sports.map(sportToResponse);
  }

  @Public()
  @Get("leagues")
  async listLeagues(@Query("sport") sport?: string) {
    const leagues = await this.storage.listLeagues(sport);
    return leagues.map(leagueToResponse);
  }

  @Public()
  @Get("events")
  async listOdds(
    @Query("sport") sport?: string,
    // A query param arrives as a string and class-validator won't coerce it,
    // so the pipe has to — `optional` keeps an absent one as undefined rather
    // than a 400.
    @Query("league", new ParseIntPipe({ optional: true }))
    league?: number,
  ) {
    const events = await this.storage.listCurrent(sport, league);
    return events.map(eventToResponse);
  }

  @Public()
  @Get("events/:eventId")
  async getOdds(@Param("eventId") eventId: string) {
    const event = await this.storage.getCurrent(eventId);
    if (event === null) {
      throw new NotFoundException("event not found");
    }
    return eventToResponse(event);
  }

  // Admin action: resolve an event and fan out the result. Auth is enforced via
  // a Keycloak access token requiring the `admin` realm role.
  @UseGuards(RolesGuard)
  @Roles("admin")
  @HttpCode(201)
  @Post("events/:eventId/result")
  async resolveEvent(
    @Param("eventId") eventId: string,
    @Body() body: ResolveEventDto,
  ) {
    const current = await this.storage.getCurrent(eventId);
    if (current === null) {
      throw new NotFoundException("event not found");
    }
    // Manual resolution is restricted to mock-origin events so we never have to
    // reconcile a real provider's own settlement against ours.
    if (current.origin !== "mock") {
      throw new ConflictException(
        "manual resolution is only allowed for mock-origin events",
      );
    }
    const result: EventResult = {
      eventId,
      sport: current.sport,
      outcome: body.outcome,
      resolvedAt: Date.now(),
    };
    await this.storage.recordResult(result);
    await this.publisher.publishResult(result);
    return {
      eventId: result.eventId,
      outcome: result.outcome,
      resolvedAt: result.resolvedAt,
    };
  }
}
