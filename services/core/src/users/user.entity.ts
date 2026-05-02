import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, OneToMany,
} from 'typeorm';
import { Bet } from '../bets/bet.entity';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  email: string;

  @Column()
  passwordHash: string;

  @Column({ default: 0, type: 'decimal', precision: 12, scale: 2 })
  balance: number;

  @OneToMany(() => Bet, (bet) => bet.user)
  bets: Bet[];

  @CreateDateColumn()
  createdAt: Date;
}
