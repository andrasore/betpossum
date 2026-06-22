// Runtime configuration for the bot daemon, all overridable via env. Defaults
// target the local dev stack (nginx single origin on :8080, master account
// admin/admin from docker-compose's KC_BOOTSTRAP_ADMIN_*).

function str(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") {
    return fallback;
  }
  const parsed = Number(raw);
  if (Number.isNaN(parsed)) {
    throw new Error(`Invalid number for ${name}: ${raw}`);
  }
  return parsed;
}

export interface Config {
  baseUrl: string;
  realm: string;
  clientId: string;
  // Master (master-realm) admin used only to provision the client + bot users.
  kcAdmin: string;
  kcAdminPassword: string;
  // App admin (realm `user` with the `admin` role) used to fund bot wallets.
  adminUser: string;
  adminPassword: string;
  botCount: number;
  botPassword: string;
  startingBalance: number;
  // Bet loop cadence: base interval with +/- jitter, and how many bots act per tick.
  betIntervalMs: number;
  betJitterMs: number;
  betsPerTick: number;
  // Stake sizing as a fraction of the bot's current balance, with a floor.
  minStakeFraction: number;
  maxStakeFraction: number;
  minStake: number;
}

export function loadConfig(): Config {
  const baseUrl = str("BOT_BASE_URL", "http://localhost:8080").replace(
    /\/$/,
    "",
  );
  return {
    baseUrl,
    realm: str("BOT_REALM", "betting"),
    clientId: str("BOT_CLIENT_ID", "betting-bots"),
    kcAdmin: str("KC_ADMIN", "admin"),
    kcAdminPassword: str("KC_ADMIN_PASSWORD", "admin"),
    adminUser: str("ADMIN_USER", "bob"),
    adminPassword: str("ADMIN_PASSWORD", "password"),
    botCount: num("BOT_COUNT", 10),
    botPassword: str("BOT_PASSWORD", "password"),
    startingBalance: num("BOT_STARTING_BALANCE", 1000),
    betIntervalMs: num("BOT_BET_INTERVAL_MS", 8000),
    betJitterMs: num("BOT_BET_JITTER_MS", 4000),
    betsPerTick: num("BOT_BETS_PER_TICK", 3),
    minStakeFraction: num("BOT_MIN_STAKE_FRACTION", 0.02),
    maxStakeFraction: num("BOT_MAX_STAKE_FRACTION", 0.12),
    minStake: num("BOT_MIN_STAKE", 5),
  };
}
