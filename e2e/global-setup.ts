import { captureLogs, compose } from "./compose";

const KEYCLOAK_DISCOVERY =
  "http://localhost:18080/kc/realms/betting/.well-known/openid-configuration";
const FRONTEND_URL = "http://localhost:18080";

async function waitFor(
  url: string,
  label: string,
  timeoutMs = 90_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastErr: unknown = null;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { redirect: "manual" });
      if (res.status < 500) {
        console.log(`  ${label} ready (${res.status})`);
        return;
      }
      lastErr = `HTTP ${res.status}`;
    } catch (e) {
      lastErr = e;
    }
    await new Promise((r) => setTimeout(r, 1_000));
  }
  throw new Error(`Timed out waiting for ${label} at ${url}: ${lastErr}`);
}

export default async function globalSetup(): Promise<void> {
  try {
    console.log("→ Booting e2e stack");
    compose(["up", "-d", "--build", "--wait"]);

    console.log("→ Waiting for Keycloak realm import");
    await waitFor(KEYCLOAK_DISCOVERY, "keycloak");

    console.log("→ Waiting for frontend");
    await waitFor(FRONTEND_URL, "frontend");
  } catch (err) {
    console.error("→ Setup failed — capturing docker logs");
    try {
      captureLogs();
    } catch (logErr) {
      console.error("  failed to capture logs:", logErr);
    }
    throw err;
  }
}
