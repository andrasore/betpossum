// Entry point: provision the realm (client + bot users) via the master account,
// fund each bot through the app admin, then run the bet loop until interrupted.
// The bots only place bets — events are resolved by the real sports providers,
// so there is no resolution logic here.

import { getBalance, getOdds, setBalance } from "./api.js";
import { Bot } from "./bot.js";
import { type Config, loadConfig } from "./config.js";
import {
  createBotUser,
  decodeSub,
  ensureBotsClient,
  getMasterToken,
  login,
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

// Create a bot user, sign it in, lazily create its Core user/wallet (the warm-up
// balance read), then fund it. Order matters: the wallet must exist before the
// admin can set its balance.
async function provisionBot(
  cfg: Config,
  masterToken: string,
  adminToken: string,
  index: number,
): Promise<Bot> {
  const name = generateName(index);
  await createBotUser(cfg, masterToken, name);
  const session = await login(cfg, name.username, cfg.botPassword);
  const sub = decodeSub(session.accessToken);
  // Warm-up: first authed call lazily creates the user + TigerBeetle wallet.
  await getBalance(cfg, session.accessToken);
  await setBalance(cfg, adminToken, sub, cfg.startingBalance);
  return new Bot(name.username, sub, session, cfg.startingBalance);
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

async function main(): Promise<void> {
  const cfg = loadConfig();
  console.log(`Provisioning ${cfg.botCount} bots against ${cfg.baseUrl}`);

  const master = await getMasterToken(cfg);
  await ensureBotsClient(cfg, master.accessToken);
  const admin = await login(cfg, cfg.adminUser, cfg.adminPassword);

  const bots: Bot[] = [];
  for (let i = 0; i < cfg.botCount; i++) {
    const bot = await provisionBot(
      cfg,
      master.accessToken,
      admin.accessToken,
      i,
    );
    bots.push(bot);
    console.log(`provisioned ${bot.username} (funded $${cfg.startingBalance})`);
  }

  let running = true;
  process.on("SIGINT", () => {
    console.log("\nstopping…");
    running = false;
  });

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
