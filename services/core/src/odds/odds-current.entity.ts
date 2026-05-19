import { Column, Entity, PrimaryColumn } from 'typeorm';

const bigintAsNumber = {
  to: (v: number) => v,
  from: (v: string | number) => (typeof v === 'string' ? Number(v) : v),
};

@Entity({ name: 'odds_current', synchronize: false })
export class OddsCurrent {
  @PrimaryColumn({ name: 'event_id' })
  eventId!: string;

  @Column()
  sport!: string;

  @Column({ name: 'home_team' })
  homeTeam!: string;

  @Column({ name: 'away_team' })
  awayTeam!: string;

  @Column({ type: 'double precision', name: 'home_odds' })
  homeOdds!: number;

  @Column({ type: 'double precision', name: 'away_odds' })
  awayOdds!: number;

  @Column({ type: 'double precision', name: 'draw_odds', default: 0 })
  drawOdds!: number;

  @Column({ type: 'bigint', name: 'updated_at', transformer: bigintAsNumber })
  updatedAt!: number;
}
