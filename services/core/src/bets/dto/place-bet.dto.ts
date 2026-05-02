import { IsIn, IsNumber, IsPositive, IsString, IsUUID } from 'class-validator';

export class PlaceBetDto {
  @IsString()
  eventId: string;

  @IsIn(['home', 'away', 'draw'])
  selection: 'home' | 'away' | 'draw';

  @IsNumber()
  @IsPositive()
  odds: number;

  @IsNumber()
  @IsPositive()
  stake: number;
}
