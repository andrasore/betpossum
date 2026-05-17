import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from './user.entity';
import { CreateUserDto } from './dto/create-user.dto';
import { WalletService } from '../wallet/wallet.service';

export interface UserView {
  id: string;
  email: string | null;
  name: string | null;
  createdAt: Date;
}

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    @InjectRepository(User) private readonly repo: Repository<User>,
    private readonly wallet: WalletService,
  ) {}

  async findById(id: string): Promise<User | null> {
    return this.repo.findOneBy({ id });
  }

  async createUser(dto: CreateUserDto): Promise<UserView> {
    const existing = await this.repo.findOneBy({ id: dto.id });
    if (existing) {
      throw new ConflictException(`User ${dto.id} already exists`);
    }
    // TODO this is not updated when someone changes their name in keycloak
    const local = await this.repo.save(this.repo.create({
      id: dto.id,
      email: dto.email ?? null,
      name: dto.name ?? null,
    }));
    this.logger.log(`Creating wallet account for new user ${local.id}`);
    // TODO maybe expect this to fail
    await this.wallet.createAccount(local.id);
    return {
      id: local.id,
      email: dto.email ?? null,
      name: dto.name ?? null,
      createdAt: local.createdAt,
    };
  }
}
