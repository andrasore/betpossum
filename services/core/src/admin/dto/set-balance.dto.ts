import { IsNumber, Min } from 'class-validator';

export class SetBalanceDto {
  @IsNumber()
  @Min(0)
  amount!: number;
}
