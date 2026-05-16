import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface KeycloakUser {
  id: string;
  email: string | null;
  name: string | null;
}

interface AdminTokenResponse {
  access_token: string;
  expires_in: number;
}

interface KeycloakUserRepresentation {
  id: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  username?: string;
}

@Injectable()
export class KeycloakService {
  private adminToken: string | null = null;
  private adminTokenExpiresAt = 0;

  constructor(private readonly config: ConfigService) {}

  get internalBaseUrl(): string {
    return this.config.get<string>('KEYCLOAK_INTERNAL_URL', 'http://keycloak:8080');
  }

  get realm(): string {
    return this.config.get<string>('KEYCLOAK_REALM', 'betting');
  }

  get issuerUrl(): string {
    const issuer = this.config.get<string>('KEYCLOAK_ISSUER_URL');
    if (issuer) return issuer;
    return `${this.internalBaseUrl}/realms/${this.realm}`;
  }

  get jwksUri(): string {
    return `${this.internalBaseUrl}/realms/${this.realm}/protocol/openid-connect/certs`;
  }

  async findUserById(id: string): Promise<KeycloakUser | null> {
    const res = await this.adminFetch(`/users/${encodeURIComponent(id)}`);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Keycloak admin: GET user ${id} failed (${res.status})`);
    return this.toUser(await res.json() as KeycloakUserRepresentation);
  }

  async findUserByEmail(email: string): Promise<KeycloakUser | null> {
    const params = new URLSearchParams({ email, exact: 'true' });
    const res = await this.adminFetch(`/users?${params.toString()}`);
    if (!res.ok) throw new Error(`Keycloak admin: search by email failed (${res.status})`);
    const list = await res.json() as KeycloakUserRepresentation[];
    if (list.length === 0) return null;
    return this.toUser(list[0]);
  }

  private toUser(rep: KeycloakUserRepresentation): KeycloakUser {
    const fullName = [rep.firstName, rep.lastName].filter(Boolean).join(' ').trim();
    return {
      id: rep.id,
      email: rep.email ?? null,
      name: fullName || rep.username || null,
    };
  }

  private async adminFetch(path: string): Promise<Response> {
    const token = await this.getAdminToken();
    return fetch(`${this.internalBaseUrl}/admin/realms/${this.realm}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  }

  private async getAdminToken(): Promise<string> {
    const now = Date.now();
    if (this.adminToken && now < this.adminTokenExpiresAt - 5_000) return this.adminToken;

    const clientId = this.config.get<string>('KEYCLOAK_ADMIN_CLIENT_ID', 'betting-core');
    const clientSecret = this.config.get<string>('KEYCLOAK_ADMIN_CLIENT_SECRET', '');
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
    });
    const res = await fetch(
      `${this.internalBaseUrl}/realms/${this.realm}/protocol/openid-connect/token`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      },
    );
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Keycloak admin token request failed (${res.status}): ${text}`);
    }
    const json = await res.json() as AdminTokenResponse;
    this.adminToken = json.access_token;
    this.adminTokenExpiresAt = now + json.expires_in * 1000;
    return this.adminToken;
  }
}
