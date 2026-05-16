import {
  Entity, PrimaryColumn, CreateDateColumn, OneToMany,
} from 'typeorm';
import { Bet } from '../bets/bet.entity';

@Entity('users')
export class User {
  @PrimaryColumn('uuid')
  id!: string;

  @OneToMany(() => Bet, (bet) => bet.user)
  bets!: Bet[];

  @CreateDateColumn()
  createdAt!: Date;
}
