import { IsIn } from 'class-validator';

export class SettleEventDto {
  @IsIn(['home', 'away', 'draw'])
  outcome!: 'home' | 'away' | 'draw';
}
