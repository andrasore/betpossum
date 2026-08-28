import {
  Column,
  Entity,
  Index,
  PrimaryColumn,
  PrimaryGeneratedColumn,
} from "typeorm";
import type { Market } from "../odds/models";

// TypeORM hands `bigint` back as a string; without this every timestamp and id
// would arrive as text.
const asNumber = {
  to: (value: number | null): number | null => value,
  from: (value: string | number | null): number | null =>
    value === null || value === undefined ? null : Number(value),
};

@Entity("odds_current")
export class OddsCurrent {
  @PrimaryColumn({ name: "event_id", type: "text" })
  eventId!: string;

  @Column({ type: "text", default: "" })
  origin!: string;

  @Column({ type: "text" })
  sport!: string;

  @Column({ name: "home_team", type: "text" })
  homeTeam!: string;

  @Column({ name: "away_team", type: "text" })
  awayTeam!: string;

  @Column({ name: "home_odds", type: "double precision" })
  homeOdds!: number;

  @Column({ name: "away_odds", type: "double precision" })
  awayOdds!: number;

  @Column({ name: "draw_odds", type: "double precision", default: 0 })
  drawOdds!: number;

  // The flexible market model rides as JSONB so Market/Selection round-trips
  // without manual JSON handling.
  @Column({ type: "jsonb", default: () => "'[]'" })
  markets!: Market[];

  @Column({
    name: "commence_time",
    type: "bigint",
    nullable: true,
    transformer: asNumber,
  })
  commenceTime!: number | null;

  @Column({ name: "updated_at", type: "bigint", transformer: asNumber })
  updatedAt!: number;

  @Column({ type: "text", nullable: true })
  outcome!: string | null;

  @Column({
    name: "resolved_at",
    type: "bigint",
    nullable: true,
    transformer: asNumber,
  })
  resolvedAt!: number | null;

  // Canonical entity links resolved at ingest; nullable so a resolution miss
  // never blocks recording the odds.
  @Column({ name: "sport_slug", type: "text", nullable: true })
  sportSlug!: string | null;

  @Column({
    name: "league_id",
    type: "bigint",
    nullable: true,
    transformer: asNumber,
  })
  leagueId!: number | null;

  @Column({
    name: "home_team_id",
    type: "bigint",
    nullable: true,
    transformer: asNumber,
  })
  homeTeamId!: number | null;

  @Column({
    name: "away_team_id",
    type: "bigint",
    nullable: true,
    transformer: asNumber,
  })
  awayTeamId!: number | null;
}

// Append-only: every tick lands here while odds_current is upserted in place.
// The index is (event_id, updated_at); Postgres scans it backwards for the
// descending reads, so no DESC declaration is needed.
@Index("idx_history_event_time", ["eventId", "updatedAt"])
@Entity("odds_history")
export class OddsHistory {
  @PrimaryGeneratedColumn("increment", { type: "bigint" })
  id!: string;

  @Column({ name: "event_id", type: "text" })
  eventId!: string;

  @Column({ type: "text" })
  sport!: string;

  @Column({ name: "home_team", type: "text" })
  homeTeam!: string;

  @Column({ name: "away_team", type: "text" })
  awayTeam!: string;

  @Column({ name: "home_odds", type: "double precision" })
  homeOdds!: number;

  @Column({ name: "away_odds", type: "double precision" })
  awayOdds!: number;

  @Column({ name: "draw_odds", type: "double precision", default: 0 })
  drawOdds!: number;

  @Column({ type: "jsonb", default: () => "'[]'" })
  markets!: Market[];

  @Column({ name: "updated_at", type: "bigint", transformer: asNumber })
  updatedAt!: number;

  @Column({ name: "sport_slug", type: "text", nullable: true })
  sportSlug!: string | null;

  @Column({
    name: "league_id",
    type: "bigint",
    nullable: true,
    transformer: asNumber,
  })
  leagueId!: number | null;

  @Column({
    name: "home_team_id",
    type: "bigint",
    nullable: true,
    transformer: asNumber,
  })
  homeTeamId!: number | null;

  @Column({
    name: "away_team_id",
    type: "bigint",
    nullable: true,
    transformer: asNumber,
  })
  awayTeamId!: number | null;
}

@Index("idx_source_map_canonical", ["canonicalEventId"])
@Entity("event_source_map")
export class EventSourceMap {
  @PrimaryColumn({ type: "text" })
  provider!: string;

  @PrimaryColumn({ name: "source_event_id", type: "text" })
  sourceEventId!: string;

  @Column({ name: "canonical_event_id", type: "text" })
  canonicalEventId!: string;

  @Column({ name: "source_sport", type: "text", nullable: true })
  sourceSport!: string | null;

  @Column({ name: "updated_at", type: "bigint", transformer: asNumber })
  updatedAt!: number;
}

// ── Canonical reference entities + per-provider source maps ──────────────────
//
// Same shape as `event_source_map`: a provider-agnostic canonical row plus a
// `(provider, source_key) -> canonical_id` map. Two providers whose labels
// reduce to the same match key (`odds/normalize.ts`) converge onto one canonical
// row — that is the cross-provider merge. `match_key` is unique *within a sport*
// so a name collision across sports can't merge two entities. Country is
// enrichment, not part of the match.

@Entity("sport")
export class Sport {
  @PrimaryColumn({ type: "text" })
  slug!: string;

  @Column({ type: "text" })
  title!: string;
}

@Index("uq_league_sport_match", ["sportSlug", "matchKey"], { unique: true })
@Entity("league")
export class League {
  @PrimaryGeneratedColumn("increment", { type: "bigint" })
  id!: string;

  @Column({ name: "sport_slug", type: "text" })
  sportSlug!: string;

  @Column({ type: "text" })
  name!: string;

  @Column({ name: "match_key", type: "text" })
  matchKey!: string;

  @Column({ type: "text", nullable: true })
  country!: string | null;
}

@Index("uq_team_sport_match", ["sportSlug", "matchKey"], { unique: true })
@Entity("team")
export class Team {
  @PrimaryGeneratedColumn("increment", { type: "bigint" })
  id!: string;

  @Column({ name: "sport_slug", type: "text" })
  sportSlug!: string;

  @Column({ type: "text" })
  name!: string;

  @Column({ name: "match_key", type: "text" })
  matchKey!: string;

  @Column({ type: "text", nullable: true })
  country!: string | null;
}

@Entity("sport_source_map")
export class SportSourceMap {
  @PrimaryColumn({ type: "text" })
  provider!: string;

  @PrimaryColumn({ name: "source_key", type: "text" })
  sourceKey!: string;

  @Column({ name: "sport_slug", type: "text" })
  sportSlug!: string;

  @Column({ name: "updated_at", type: "bigint", transformer: asNumber })
  updatedAt!: number;
}

@Index("idx_league_source_canonical", ["leagueId"])
@Entity("league_source_map")
export class LeagueSourceMap {
  @PrimaryColumn({ type: "text" })
  provider!: string;

  @PrimaryColumn({ name: "source_key", type: "text" })
  sourceKey!: string;

  @Column({ name: "league_id", type: "bigint", transformer: asNumber })
  leagueId!: number;

  @Column({ name: "source_name", type: "text", nullable: true })
  sourceName!: string | null;

  @Column({ name: "source_country", type: "text", nullable: true })
  sourceCountry!: string | null;

  @Column({ name: "updated_at", type: "bigint", transformer: asNumber })
  updatedAt!: number;
}

@Index("idx_team_source_canonical", ["teamId"])
@Entity("team_source_map")
export class TeamSourceMap {
  @PrimaryColumn({ type: "text" })
  provider!: string;

  @PrimaryColumn({ name: "source_key", type: "text" })
  sourceKey!: string;

  @Column({ name: "team_id", type: "bigint", transformer: asNumber })
  teamId!: number;

  @Column({ name: "source_name", type: "text", nullable: true })
  sourceName!: string | null;

  @Column({ name: "updated_at", type: "bigint", transformer: asNumber })
  updatedAt!: number;
}

export const ODDS_ENTITIES = [
  OddsCurrent,
  OddsHistory,
  EventSourceMap,
  Sport,
  League,
  Team,
  SportSourceMap,
  LeagueSourceMap,
  TeamSourceMap,
];
