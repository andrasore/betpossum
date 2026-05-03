import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn,
} from 'typeorm';
import { User } from '../users/user.entity';

export type BetSelection = 'home' | 'away' | 'draw';
export type BetStatus = 'pending' | 'held' | 'won' | 'lost';

@Entity('bets')
export class Bet {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => User, (user) => user.bets, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: User;

  @Column({ name: 'user_id' })
  userId!: string;

  @Column()
  eventId!: string;

  @Column({ type: 'varchar' })
  selection!: BetSelection;

  @Column({ type: 'decimal', precision: 10, scale: 4 })
  odds!: number;

  @Column({ type: 'decimal', precision: 12, scale: 2 })
  stake!: number;

  @Column({ type: 'decimal', precision: 12, scale: 2, nullable: true })
  payout!: number | null;

  @Column({ type: 'varchar', default: 'pending' })
  status!: BetStatus;

  @CreateDateColumn()
  placedAt!: Date;
}
