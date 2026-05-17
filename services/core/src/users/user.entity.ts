import {
  Entity, PrimaryColumn, Column, CreateDateColumn, OneToMany,
} from 'typeorm';
import { Bet } from '../bets/bet.entity';

@Entity('users')
export class User {
  @PrimaryColumn('uuid')
  id!: string;

  @Column({ type: 'text', nullable: true })
  email!: string | null;

  @Column({ type: 'text', nullable: true })
  name!: string | null;

  @OneToMany(() => Bet, (bet) => bet.user)
  bets!: Bet[];

  @CreateDateColumn()
  createdAt!: Date;
}
