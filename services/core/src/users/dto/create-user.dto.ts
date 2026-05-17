import { IsEmail, IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateUserDto {
  @IsUUID()
  id!: string;

  @IsOptional()
  @IsEmail()
  email?: string | null;

  @IsOptional()
  @IsString()
  name?: string | null;
}
