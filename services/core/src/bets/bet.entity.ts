import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from "typeorm";
import { User } from "../users/user.entity";

export type BetSelection = "home" | "away" | "draw";
export type BetStatus = "pending" | "held" | "won" | "lost";

@Entity("bets")
export class Bet {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @ManyToOne(
    () => User,
    (user) => user.bets,
    { onDelete: "CASCADE" },
  )
  @JoinColumn({ name: "user_id" })
  user!: User;

  @Column({ name: "user_id" })
  userId!: string;

  @Column()
  eventId!: string;

  @Column({ type: "varchar" })
  selection!: BetSelection;

  // A ratio, not money — stays decimal. Postgres returns `numeric` as a
  // string, hence the `Number()` at every read site.
  @Column({ type: "decimal", precision: 10, scale: 4 })
  odds!: number;

  // Money is integer cents. `integer` also comes back from pg as a real JS
  // number, unlike `numeric`.
  @Column({ type: "integer", name: "stake_cents" })
  stakeCents!: number;

  // Profit only (stake * (odds - 1)), not total return.
  @Column({ type: "integer", name: "payout_cents", nullable: true })
  payoutCents!: number | null;

  @Column({ type: "varchar", default: "pending" })
  status!: BetStatus;

  @CreateDateColumn()
  placedAt!: Date;
}
