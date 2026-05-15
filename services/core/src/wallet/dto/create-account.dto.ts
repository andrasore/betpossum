import { IsString } from 'class-validator';

export class CreateAccountDto {
  @IsString()
  userId!: string;
}
