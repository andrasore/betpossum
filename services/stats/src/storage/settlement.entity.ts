import { Column, Entity, Index, PrimaryColumn } from "typeorm";

// TypeORM hands `bigint` back as a string; without this every cents sum would
// silently become string concatenation.
const asNumber = {
  to: (value: number): number => value,
  from: (value: string | number): number => Number(value),
};

@Entity("stats_settlements")
export class Settlement {
  @PrimaryColumn({ name: "bet_id", type: "text" })
  betId!: string;

  @Index()
  @Column({ name: "user_id", type: "text" })
  userId!: string;

  @Column({ name: "user_name", type: "text", nullable: true })
  userName!: string | null;

  /** Unix ms. */
  @Column({ name: "settled_at", type: "bigint", transformer: asNumber })
  settledAt!: number;

  @Column({ name: "stake_cents", type: "bigint", transformer: asNumber })
  stakeCents!: number;

  /** Signed: +profit on a win, -stake on a loss, so a plain SUM is net P&L. */
  @Column({ name: "profit_cents", type: "bigint", transformer: asNumber })
  profitCents!: number;
}
