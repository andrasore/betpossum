export interface AppConfig {
  keycloakUrl: string;
  keycloakRealm: string;
  keycloakClientId: string;
  // Host port of the nginx gateway in front of core + notifications.
  // Hostname is taken from window.location; only the port varies between
  // dev (8080) and e2e (18080) so both stacks can run side-by-side.
  gatewayPort: number;
}

declare global {
  interface Window {
    __APP_CONFIG__?: AppConfig;
  }
}

// Set by the blocking <script src="/runtime-config.js"> tag in the root layout.
// That route handler reads process.env at request time, so values come from the
// container's environment — not build-time NEXT_PUBLIC_* substitution.
export function getConfig(): AppConfig {
  if (typeof window === "undefined") {
    throw new Error("getConfig() must only be called from client code");
  }
  const cfg = window.__APP_CONFIG__;
  if (!cfg)
    throw new Error(
      "window.__APP_CONFIG__ was not loaded — is /runtime-config.js reachable?",
    );
  return cfg;
}
