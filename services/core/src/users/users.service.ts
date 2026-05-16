import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from './user.entity';
import { KeycloakService } from '../keycloak/keycloak.service';
import type { KeycloakJwtPayload } from '../keycloak/jwt.strategy';

export interface UserView {
  id: string;
  email: string | null;
  name: string | null;
  createdAt: Date;
}

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User) private readonly repo: Repository<User>,
    private readonly keycloak: KeycloakService,
  ) {}

  async findById(id: string): Promise<UserView | null> {
    const local = await this.repo.findOneBy({ id });
    if (!local) return null;
    const kc = await this.keycloak.findUserById(id);
    return {
      id: local.id,
      email: kc?.email ?? null,
      name: kc?.name ?? null,
      createdAt: local.createdAt,
    };
  }

  async findByEmail(email: string): Promise<UserView | null> {
    const kc = await this.keycloak.findUserByEmail(email);
    if (!kc) return null;
    const local = await this.repo.findOneBy({ id: kc.id });
    if (!local) return null;
    return {
      id: local.id,
      email: kc.email,
      name: kc.name,
      createdAt: local.createdAt,
    };
  }

  async ensureFromJwt(payload: KeycloakJwtPayload): Promise<UserView> {
    const existing = await this.repo.findOneBy({ id: payload.sub });
    const local = existing ?? (await this.repo.save(this.repo.create({ id: payload.sub })));
    const fullName = [payload.given_name, payload.family_name].filter(Boolean).join(' ').trim();
    const name = payload.name ?? (fullName || payload.preferred_username || null);
    return {
      id: local.id,
      email: payload.email ?? null,
      name: name || null,
      createdAt: local.createdAt,
    };
  }
}
