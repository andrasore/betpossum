import { Injectable } from "@nestjs/common";
import type { DataSource, EntityManager } from "typeorm";
import { In } from "typeorm";
import {
  type CanonicalEvent,
  type CanonicalLeague,
  type CanonicalSport,
  type EventResult,
  h2hOdds,
  type Outcome,
} from "../odds/models";
import {
  leagueMatchKey,
  slugifySport,
  sportTitle,
  teamMatchKey,
} from "../odds/normalize";
import { League, OddsCurrent, Sport, Team } from "./entities";
import { OddsStorage } from "./odds-storage";

// Columns refreshed on an odds_current conflict (everything but the PK, and
// notably *not* outcome/resolved_at — a fresh tick must never un-resolve an
// event).
const CURRENT_UPDATE_COLS = [
  "origin",
  "sport",
  "home_team",
  "away_team",
  "home_odds",
  "away_odds",
  "draw_odds",
  "markets",
  "commence_time",
  "updated_at",
  "sport_slug",
  "league_id",
  "home_team_id",
  "away_team_id",
];

function toEvent(
  row: OddsCurrent,
  names: {
    sportTitle?: string | null;
    leagueName?: string | null;
    homeTeamName?: string | null;
    awayTeamName?: string | null;
  } = {},
): CanonicalEvent {
  return {
    eventId: row.eventId,
    origin: row.origin,
    sourceEventId: row.eventId.slice(row.eventId.indexOf(":") + 1),
    sport: row.sport,
    homeTeam: row.homeTeam,
    awayTeam: row.awayTeam,
    commenceTime: row.commenceTime,
    markets: row.markets ?? [],
    updatedAt: row.updatedAt,
    outcome: (row.outcome as Outcome | null) ?? null,
    resolvedAt: row.resolvedAt,
    // Canonical display names from the entity join (null when unlinked).
    sportTitle: names.sportTitle ?? null,
    leagueId: row.leagueId,
    leagueName: names.leagueName ?? null,
    homeTeamName: names.homeTeamName ?? null,
    awayTeamName: names.awayTeamName ?? null,
  };
}

@Injectable()
export class PostgresStorage extends OddsStorage {
  constructor(private readonly dataSource: DataSource) {
    super();
  }

  // ── Entity resolution ─────────────────────────────────────────────────────
  //
  // The get-or-create-returning-id idiom is `ON CONFLICT ... DO UPDATE`, not
  // `DO NOTHING`: only DO UPDATE makes RETURNING yield the *existing* row's id
  // on a conflict. The country update is a COALESCE so a first-seen value is
  // kept and only a missing one is backfilled — which TypeORM's `.orUpdate()`
  // cannot express, hence the raw SQL here.

  private async resolveSport(
    em: EntityManager,
    event: CanonicalEvent,
  ): Promise<string> {
    const slug = slugifySport(event.sport, event.sportGroup);
    await em.query(
      `INSERT INTO sport (slug, title) VALUES ($1, $2)
       ON CONFLICT (slug) DO NOTHING`,
      [slug, sportTitle(slug)],
    );
    await em.query(
      `INSERT INTO sport_source_map (provider, source_key, sport_slug, updated_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (provider, source_key) DO UPDATE
         SET sport_slug = EXCLUDED.sport_slug, updated_at = EXCLUDED.updated_at`,
      [event.origin, event.sport, slug, event.updatedAt],
    );
    return slug;
  }

  private async resolveLeague(
    em: EntityManager,
    event: CanonicalEvent,
    sportSlug: string,
  ): Promise<number | null> {
    if (!event.leagueKey || !event.leagueName) {
      return null;
    }
    const matchKey = leagueMatchKey(event.leagueName);
    const [{ id }] = (await em.query(
      `INSERT INTO league (sport_slug, name, match_key, country)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (sport_slug, match_key) DO UPDATE
         SET country = COALESCE(league.country, EXCLUDED.country)
       RETURNING id`,
      [sportSlug, event.leagueName, matchKey, event.country ?? null],
    )) as [{ id: string }];
    const leagueId = Number(id);

    await em.query(
      `INSERT INTO league_source_map
         (provider, source_key, league_id, source_name, source_country, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (provider, source_key) DO UPDATE
         SET league_id = EXCLUDED.league_id,
             source_name = EXCLUDED.source_name,
             source_country = EXCLUDED.source_country,
             updated_at = EXCLUDED.updated_at`,
      [
        event.origin,
        event.leagueKey,
        leagueId,
        event.leagueName,
        event.country ?? null,
        event.updatedAt,
      ],
    );
    return leagueId;
  }

  private async resolveTeam(
    em: EntityManager,
    event: CanonicalEvent,
    sportSlug: string,
    name: string,
    sourceKey: string | null | undefined,
  ): Promise<number | null> {
    if (!name) {
      return null;
    }
    const matchKey = teamMatchKey(name);
    // A provider without team ids (The Odds API) keys its source map by the
    // match key, so its rows still collapse onto the shared canonical team.
    const key = sourceKey || matchKey;
    const [{ id }] = (await em.query(
      `INSERT INTO team (sport_slug, name, match_key, country)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (sport_slug, match_key) DO UPDATE
         SET country = COALESCE(team.country, EXCLUDED.country)
       RETURNING id`,
      [sportSlug, name, matchKey, event.country ?? null],
    )) as [{ id: string }];
    const teamId = Number(id);

    await em.query(
      `INSERT INTO team_source_map
         (provider, source_key, team_id, source_name, updated_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (provider, source_key) DO UPDATE
         SET team_id = EXCLUDED.team_id,
             source_name = EXCLUDED.source_name,
             updated_at = EXCLUDED.updated_at`,
      [event.origin, key, teamId, name, event.updatedAt],
    );
    return teamId;
  }

  async record(event: CanonicalEvent): Promise<void> {
    const projected = h2hOdds(event);
    const [homeOdds, awayOdds, drawOdds] = projected ?? [0, 0, 0];
    const markets = JSON.stringify(event.markets);

    // One transaction: resolve the canonical sport/league/team links, append
    // history, then upsert current + the event source map.
    await this.dataSource.transaction(async (em) => {
      const sportSlug = await this.resolveSport(em, event);
      const leagueId = await this.resolveLeague(em, event, sportSlug);
      const homeTeamId = await this.resolveTeam(
        em,
        event,
        sportSlug,
        event.homeTeam,
        event.homeTeamKey,
      );
      const awayTeamId = await this.resolveTeam(
        em,
        event,
        sportSlug,
        event.awayTeam,
        event.awayTeamKey,
      );

      await em.query(
        `INSERT INTO odds_history
           (event_id, sport, home_team, away_team, home_odds, away_odds,
            draw_odds, markets, updated_at, sport_slug, league_id,
            home_team_id, away_team_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [
          event.eventId,
          event.sport,
          event.homeTeam,
          event.awayTeam,
          homeOdds,
          awayOdds,
          drawOdds,
          markets,
          event.updatedAt,
          sportSlug,
          leagueId,
          homeTeamId,
          awayTeamId,
        ],
      );

      const updates = CURRENT_UPDATE_COLS.map(
        (col) => `${col} = EXCLUDED.${col}`,
      ).join(", ");
      await em.query(
        `INSERT INTO odds_current
           (event_id, origin, sport, home_team, away_team, home_odds, away_odds,
            draw_odds, markets, commence_time, updated_at, sport_slug,
            league_id, home_team_id, away_team_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
         ON CONFLICT (event_id) DO UPDATE SET ${updates}`,
        [
          event.eventId,
          event.origin,
          event.sport,
          event.homeTeam,
          event.awayTeam,
          homeOdds,
          awayOdds,
          drawOdds,
          markets,
          event.commenceTime ?? null,
          event.updatedAt,
          sportSlug,
          leagueId,
          homeTeamId,
          awayTeamId,
        ],
      );

      await em.query(
        `INSERT INTO event_source_map
           (provider, source_event_id, canonical_event_id, source_sport, updated_at)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (provider, source_event_id) DO UPDATE
           SET canonical_event_id = EXCLUDED.canonical_event_id,
               source_sport = EXCLUDED.source_sport,
               updated_at = EXCLUDED.updated_at`,
        [
          event.origin,
          event.sourceEventId,
          event.eventId,
          event.sport,
          event.updatedAt,
        ],
      );
    });
  }

  async recordResult(result: EventResult): Promise<void> {
    // Both callers — the admin route (mock-origin only) and a provider's
    // results poll — resolve an event that already exists, so in practice only
    // the conflict branch fires and the row keeps its real origin. The insert
    // stays as a defensive fallback: a bare row can only be mock's.
    await this.dataSource.query(
      `INSERT INTO odds_current
         (event_id, origin, sport, home_team, away_team, home_odds, away_odds,
          draw_odds, markets, updated_at, outcome, resolved_at)
       VALUES ($1, 'mock', $2, '', '', 0, 0, 0, '[]'::jsonb, 0, $3, $4)
       ON CONFLICT (event_id) DO UPDATE
         SET outcome = EXCLUDED.outcome, resolved_at = EXCLUDED.resolved_at`,
      [result.eventId, result.sport, result.outcome, result.resolvedAt],
    );
  }

  /**
   * Attach canonical sport/league/team display names to odds rows.
   *
   * Resolves the entity links via a few set-based lookups against the small
   * reference tables rather than a multi-entity join. A missing link just leaves
   * its name null — the caller falls back to the raw provider label.
   */
  private async hydrateNames(rows: OddsCurrent[]): Promise<CanonicalEvent[]> {
    const sportSlugs = [
      ...new Set(rows.map((r) => r.sportSlug).filter((s): s is string => !!s)),
    ];
    const leagueIds = [
      ...new Set(
        rows.map((r) => r.leagueId).filter((i): i is number => i !== null),
      ),
    ];
    const teamIds = [
      ...new Set(
        rows
          .flatMap((r) => [r.homeTeamId, r.awayTeamId])
          .filter((i): i is number => i !== null),
      ),
    ];

    const sportTitles = new Map<string, string>();
    if (sportSlugs.length) {
      const found = await this.dataSource
        .getRepository(Sport)
        .findBy({ slug: In(sportSlugs) });
      for (const s of found) {
        sportTitles.set(s.slug, s.title);
      }
    }

    const leagueNames = new Map<number, string>();
    if (leagueIds.length) {
      const found = await this.dataSource
        .getRepository(League)
        .findBy({ id: In(leagueIds.map(String)) });
      for (const l of found) {
        leagueNames.set(Number(l.id), l.name);
      }
    }

    const teamNames = new Map<number, string>();
    if (teamIds.length) {
      const found = await this.dataSource
        .getRepository(Team)
        .findBy({ id: In(teamIds.map(String)) });
      for (const t of found) {
        teamNames.set(Number(t.id), t.name);
      }
    }

    return rows.map((r) =>
      toEvent(r, {
        sportTitle: r.sportSlug ? sportTitles.get(r.sportSlug) : null,
        leagueName: r.leagueId !== null ? leagueNames.get(r.leagueId) : null,
        homeTeamName:
          r.homeTeamId !== null ? teamNames.get(r.homeTeamId) : null,
        awayTeamName:
          r.awayTeamId !== null ? teamNames.get(r.awayTeamId) : null,
      }),
    );
  }

  async listCurrent(
    sport?: string,
    league?: number,
  ): Promise<CanonicalEvent[]> {
    const qb = this.dataSource
      .getRepository(OddsCurrent)
      .createQueryBuilder("e")
      .orderBy("e.updated_at", "DESC");
    if (sport !== undefined) {
      // Filter on the canonical sport slug (what GET /odds/sports exposes), not
      // the raw provider label, so one chip spans every provider league.
      qb.andWhere("e.sport_slug = :sport", { sport });
    }
    if (league !== undefined) {
      // The canonical league id (GET /odds/leagues) is globally unique, so it
      // pins the league on its own — the sport filter above is redundant but
      // kept (the UI sends both since a league implies its sport).
      qb.andWhere("e.league_id = :league", { league });
    }
    return this.hydrateNames(await qb.getMany());
  }

  async getCurrent(eventId: string): Promise<CanonicalEvent | null> {
    const row = await this.dataSource
      .getRepository(OddsCurrent)
      .findOneBy({ eventId });
    if (row === null) {
      return null;
    }
    const [event] = await this.hydrateNames([row]);
    return event;
  }

  async listUnresolved(
    origin: string,
    since: number,
    before: number,
    limit: number,
  ): Promise<CanonicalEvent[]> {
    // A NULL commence_time fails both range comparisons, so an event whose
    // kickoff we never learned is excluded without a separate IS NOT NULL.
    // Oldest kickoff first: a backlog drains in order instead of starving.
    const rows = await this.dataSource
      .getRepository(OddsCurrent)
      .createQueryBuilder("e")
      .where("e.origin = :origin", { origin })
      .andWhere("e.outcome IS NULL")
      .andWhere("e.commence_time > :since", { since })
      .andWhere("e.commence_time < :before", { before })
      .orderBy("e.commence_time", "ASC")
      .limit(limit)
      .getMany();
    // Callers want ids to poll, not display names — skip the entity join.
    return rows.map((r) => toEvent(r));
  }

  async listSports(): Promise<CanonicalSport[]> {
    // The canonical `sport` table is already de-duplicated across providers, so
    // it's the right source for the filter chips (it also lists sports that have
    // no current events).
    const rows = await this.dataSource
      .getRepository(Sport)
      .find({ order: { title: "ASC" } });
    return rows.map((s) => ({ slug: s.slug, title: s.title }));
  }

  async listLeagues(sport?: string): Promise<CanonicalLeague[]> {
    // The canonical `league` table is de-duplicated across providers, like
    // `sport`. Optionally scoped to one sport (the league bar shows the selected
    // sport's leagues; unscoped lists every sport's leagues).
    const rows = await this.dataSource.getRepository(League).find({
      where: sport === undefined ? {} : { sportSlug: sport },
      order: { name: "ASC" },
    });
    return rows.map((l) => ({
      id: Number(l.id),
      name: l.name,
      sportSlug: l.sportSlug,
    }));
  }
}
