import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import type { Repository } from "typeorm";
import { WalletService } from "../wallet/wallet.service";
import type { CreateUserDto } from "./dto/create-user.dto";
import { User } from "./user.entity";

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

  async listWithBetCounts(): Promise<Array<{ user: User; betCount: number }>> {
    const rows = await this.repo
      .createQueryBuilder("u")
      .leftJoin("u.bets", "b")
      .select("u")
      .addSelect("COUNT(b.id)", "bet_count")
      .groupBy("u.id")
      .orderBy("u.createdAt", "DESC")
      .getRawAndEntities();
    return rows.entities.map((user, i) => ({
      user,
      betCount: Number(rows.raw[i].bet_count ?? 0),
    }));
  }

  async createUser(dto: CreateUserDto): Promise<UserView> {
    // TODO do not create db user for admins
    // TODO this is not updated when someone changes their name in keycloak
    // Two of a new user's first authed requests can race here (both see no
    // row), so let the primary key arbitrate instead of a check-then-insert:
    // ON CONFLICT DO NOTHING returns a row only to the request that actually
    // inserted. Only that winner provisions the wallet, so creation stays
    // idempotent and a concurrent caller no longer hits a duplicate-key error.
    const insert = await this.repo
      .createQueryBuilder()
      .insert()
      .into(User)
      .values({
        id: dto.id,
        email: dto.email ?? null,
        name: dto.name ?? null,
      })
      .orIgnore()
      .returning("*")
      .execute();

    if (insert.raw.length > 0) {
      this.logger.log(`Creating wallet account for new user ${dto.id}`);
      // TODO maybe expect this to fail
      await this.wallet.createAccount(dto.id);
    }

    const local = await this.repo.findOneByOrFail({ id: dto.id });
    return {
      id: local.id,
      email: local.email,
      name: local.name,
      createdAt: local.createdAt,
    };
  }
}
