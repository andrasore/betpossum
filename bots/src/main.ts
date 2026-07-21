// Entry point: provision the realm (client + bot users) via the master account,
// fund each bot through the app admin, then run the bet loop until interrupted.
// The bots only place bets — events are resolved by the real sports providers,
// so there is no resolution logic here.

import { getBalance, getOdds, setBalance } from "./api.js";
import { Bot } from "./bot.js";
import { type Config, loadConfig } from "./config.js";
import {
  decodeSub,
  ensureBotsClient,
  ensureBotUser,
  getMasterToken,
  login,
  type Session,
} from "./keycloak.js";
import { generateName } from "./names.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

// Ensure a bot user exists, sign it in, lazily create its Core user/wallet (the
// warm-up balance read), then fund it. Order matters: the wallet must exist
// before the admin can set its balance. Fund only freshly-created bots — on a
// restart existing bots are reused and keep their current balance (setBalance is
// absolute), so restarts neither reset play money nor mint more.
async function provisionBot(
  cfg: Config,
  masterToken: string,
  adminToken: string,
  index: number,
): Promise<Bot> {
  const name = generateName(index);
  const created = await ensureBotUser(cfg, masterToken, name);
  const session = await login(cfg, name.username, cfg.botPassword);
  const sub = decodeSub(session.accessToken);
  // Warm-up: first authed call lazily creates the user + TigerBeetle wallet.
  const balance = await getBalance(cfg, session.accessToken);
  if (created) {
    await setBalance(cfg, adminToken, sub, cfg.startingBalance);
  }
  const startingBalance = created ? cfg.startingBalance : balance;
  console.log(
    created
      ? `provisioned ${name.username} (funded $${cfg.startingBalance})`
      : `reused ${name.username} ($${balance.toFixed(2)})`,
  );
  return new Bot(name.username, sub, session, startingBalance);
}

async function betTick(cfg: Config, bots: Bot[]): Promise<void> {
  const events = await getOdds(cfg);
  const actors = shuffle(bots).slice(0, cfg.betsPerTick);
  for (const bot of actors) {
    try {
      await bot.syncBalance(cfg);
      const line = await bot.betOnce(cfg, events);
      if (line) {
        console.log(line);
      }
    } catch (err) {
      console.error(`bet failed for ${bot.username}:`, err);
    }
  }
}

// Block until the stack can serve us: Keycloak issues the master token, the
// bots client exists, the public odds endpoint answers (nginx + odds up), and
// Core serves an authed admin request (so lazy user creation will work). This
// keeps a container start during stack boot from crash-looping and leaking
// half-provisioned Keycloak users.
async function waitForStack(
  cfg: Config,
): Promise<{ master: Session; admin: Session }> {
  const retries = Number(process.env.BOT_READY_RETRIES ?? 60);
  let lastErr: unknown;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const master = await getMasterToken(cfg);
      await ensureBotsClient(cfg, master.accessToken);
      await getOdds(cfg);
      const admin = await login(cfg, cfg.adminUser, cfg.adminPassword);
      await getBalance(cfg, admin.accessToken); // Core readiness probe
      return { master, admin };
    } catch (err) {
      lastErr = err;
      console.log(`stack not ready (attempt ${attempt}/${retries}), retrying…`);
      await sleep(2000);
    }
  }
  throw new Error(`stack did not become ready: ${lastErr}`);
}

async function main(): Promise<void> {
  const cfg = loadConfig();
  console.log(`Provisioning ${cfg.botCount} bots against ${cfg.baseUrl}`);

  const { master, admin } = await waitForStack(cfg);

  const bots: Bot[] = [];
  for (let i = 0; i < cfg.botCount; i++) {
    const bot = await provisionBot(
      cfg,
      master.accessToken,
      admin.accessToken,
      i,
    );
    bots.push(bot);
  }

  let running = true;
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      console.log("\nstopping…");
      running = false;
    });
  }

  console.log("entering bet loop");
  while (running) {
    try {
      await betTick(cfg, bots);
    } catch (err) {
      console.error("tick failed:", err);
    }
    const jitter = (Math.random() * 2 - 1) * cfg.betJitterMs;
    await sleep(Math.max(500, cfg.betIntervalMs + jitter));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
