// Runtime config delivered as JavaScript so a blocking <script src> in the
// root layout sets window.__APP_CONFIG__ before any client code reads it.
// Values come from the container's environment at request time — not
// NEXT_PUBLIC_* substitution at build time — so the same image serves dev
// and e2e on different Keycloak host ports.

export const dynamic = "force-dynamic";

export function GET(): Response {
  const config = {
    keycloakUrl: process.env.KEYCLOAK_URL ?? "http://localhost:8090",
    keycloakRealm: process.env.KEYCLOAK_REALM ?? "betting",
    keycloakClientId: process.env.KEYCLOAK_CLIENT_ID ?? "betting-frontend",
    gatewayPort: Number(process.env.GATEWAY_PORT ?? 8080),
  };
  return new Response(`window.__APP_CONFIG__=${JSON.stringify(config)};`, {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
