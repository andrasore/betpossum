import type { NextAuthOptions } from "next-auth";
import type { JWT } from "next-auth/jwt";
import KeycloakProvider from "next-auth/providers/keycloak";

// The public issuer matches the `iss` claim in tokens and is the URL the
// browser is redirected to. Server-to-server calls from inside docker reach
// Keycloak via the internal URL — that's what `wellKnown` points at. With
// `KC_HOSTNAME_BACKCHANNEL_DYNAMIC=true` on Keycloak, the discovery response
// from the internal host returns backchannel endpoints (token, userinfo,
// jwks_uri) under the internal host too, while frontchannel endpoints
// (authorization, end_session) still use the public KC_HOSTNAME.
const publicIssuer = (): string => process.env.NEXTAUTH_KEYCLOAK_ISSUER ?? "";
const internalIssuer = (): string =>
  process.env.NEXTAUTH_KEYCLOAK_ISSUER_INTERNAL ?? publicIssuer();

declare module "next-auth" {
  interface Session {
    accessToken?: string;
    error?: "RefreshAccessTokenError";
    roles: string[];
    user: {
      id?: string;
      name?: string | null;
      email?: string | null;
      image?: string | null;
    };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    accessToken?: string;
    refreshToken?: string;
    expiresAt?: number;
    idToken?: string;
    roles?: string[];
    error?: "RefreshAccessTokenError";
  }
}

function rolesFromAccessToken(jwt: string | undefined): string[] {
  if (!jwt) return [];
  const parts = jwt.split(".");
  if (parts.length !== 3) return [];
  try {
    const payload = JSON.parse(
      Buffer.from(
        parts[1].replace(/-/g, "+").replace(/_/g, "/"),
        "base64",
      ).toString("utf8"),
    ) as { realm_access?: { roles?: string[] } };
    return payload.realm_access?.roles ?? [];
  } catch {
    return [];
  }
}

async function refreshAccessToken(token: JWT): Promise<JWT> {
  try {
    if (!token.refreshToken) throw new Error("No refresh token");
    const res = await fetch(
      `${internalIssuer()}/protocol/openid-connect/token`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          client_id: process.env.NEXTAUTH_KEYCLOAK_ID ?? "",
          client_secret: process.env.NEXTAUTH_KEYCLOAK_SECRET ?? "",
          refresh_token: token.refreshToken,
        }),
      },
    );
    if (!res.ok) throw new Error(`refresh failed: ${res.status}`);
    const json = (await res.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in: number;
    };
    return {
      ...token,
      accessToken: json.access_token,
      refreshToken: json.refresh_token ?? token.refreshToken,
      expiresAt: Math.floor(Date.now() / 1000) + json.expires_in,
      roles: rolesFromAccessToken(json.access_token),
      error: undefined,
    };
  } catch {
    return { ...token, error: "RefreshAccessTokenError" };
  }
}

export const authOptions: NextAuthOptions = {
  providers: [
    KeycloakProvider({
      clientId: process.env.NEXTAUTH_KEYCLOAK_ID ?? "",
      clientSecret: process.env.NEXTAUTH_KEYCLOAK_SECRET ?? "",
      issuer: publicIssuer(),
      wellKnown: `${internalIssuer()}/.well-known/openid-configuration`,
    }),
  ],
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  callbacks: {
    async jwt({ token, account }) {
      if (account) {
        return {
          ...token,
          accessToken: account.access_token,
          refreshToken: account.refresh_token,
          expiresAt: account.expires_at,
          idToken: account.id_token,
          roles: rolesFromAccessToken(account.access_token),
        };
      }
      if (token.expiresAt && Date.now() < token.expiresAt * 1000 - 30_000) {
        return token;
      }
      return refreshAccessToken(token);
    },
    async session({ session, token }) {
      session.accessToken = token.accessToken;
      session.roles = token.roles ?? [];
      session.error = token.error;
      if (token.sub) session.user.id = token.sub;
      return session;
    },
  },
  events: {
    async signOut({ token }) {
      const idToken = token?.idToken;
      if (!idToken) return;
      await fetch(
        `${internalIssuer()}/protocol/openid-connect/logout?${new URLSearchParams(
          {
            id_token_hint: idToken,
            client_id: process.env.NEXTAUTH_KEYCLOAK_ID ?? "",
          },
        )}`,
      ).catch(() => undefined);
    },
  },
};
