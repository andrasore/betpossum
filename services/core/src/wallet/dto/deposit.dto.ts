import { IsNumber, IsPositive, IsString } from 'class-validator';

export class DepositDto {
  @IsString()
  userId!: string;

  @IsNumber()
  @IsPositive()
  amount!: number;
}
