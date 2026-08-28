/**
 * Pure helpers for normalizing provider sport/league/team identities.
 *
 * No DB access — this is the *matching algorithm*. The lookup/create/link
 * against Postgres lives in `storage/postgres.storage.ts`; here we only turn a
 * provider's labels into a canonical sport slug and into comparable match keys,
 * plus a small seeded set of cross-provider alias overrides for the gaps plain
 * name-normalization can't bridge ("Man City" vs "Manchester City", "EPL" vs
 * "Premier League").
 *
 * Matching is scoped by sport: leagues/teams are compared within a `sportSlug`,
 * never globally, so a name collision across sports can't merge two entities.
 * Country is enrichment, **not** part of the match key — one provider (The Odds
 * API) gives no country at all, so requiring it would defeat cross-provider
 * league matching, which is the whole point.
 */

// ── Sport ────────────────────────────────────────────────────────────────────

/** Canonical sport slug -> display title. Seeded; new sports extend this. */
export const SPORT_TITLES: Record<string, string> = {
  soccer: "Soccer",
  basketball: "Basketball",
  american_football: "American Football",
};

// Provider sport labels (The Odds API `group`, or a `sport_key` prefix) -> slug.
// API-Football's product *is* soccer, so its "football" collapses to "soccer".
const SPORT_ALIASES: Record<string, string> = {
  soccer: "soccer",
  football: "soccer",
  basketball: "basketball",
  americanfootball: "american_football",
  "american football": "american_football",
};

function stripAccents(text: string): string {
  return text.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
}

function slugify(text: string): string {
  return stripAccents(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/**
 * Map a provider's sport label to a canonical slug.
 *
 * `group` is The Odds API's broad bucket ("Soccer", "American Football") when
 * available; `sourceKey` is the provider's sport identifier ("soccer_epl",
 * "basketball_nba", or API-Football's "soccer_39"). For both odds-style keys
 * the prefix before the first underscore is the broad sport.
 */
export function slugifySport(sourceKey: string, group?: string | null): string {
  if (group) {
    const slug = SPORT_ALIASES[group.trim().toLowerCase()];
    if (slug) {
      return slug;
    }
  }
  const prefix = sourceKey.split("_", 1)[0].trim().toLowerCase();
  return SPORT_ALIASES[prefix] ?? slugify(prefix);
}

export function sportTitle(slug: string): string {
  return (
    SPORT_TITLES[slug] ??
    slug.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
  );
}

// ── Name matching ────────────────────────────────────────────────────────────

/** Tokens that carry no identity and only add noise to a name match. */
const FILLER_TOKENS = new Set(["fc", "afc", "cf", "sc", "club"]);

// Cross-provider name gaps that normalization alone can't close. Keyed by the
// normalized *variant* -> the normalized canonical key it should collapse to.
// Keep entries unambiguous within a sport; extend as new mismatches surface.
const TEAM_ALIASES: Record<string, string> = {
  "man city": "manchester city",
  "man utd": "manchester united",
  "man united": "manchester united",
  "la lakers": "los angeles lakers",
  "ny giants": "new york giants",
  "sf 49ers": "san francisco 49ers",
};

const LEAGUE_ALIASES: Record<string, string> = {
  epl: "premier league",
  "soccer epl": "premier league",
  nba: "national basketball association",
  nfl: "national football league",
};

/**
 * Reduce a team/league name to a comparable match key.
 *
 * Lowercases, strips accents and punctuation, and drops filler tokens so
 * "Manchester City FC" and "manchester city" collapse to one key. This is the
 * cheap match; gaps that survive it ("Man City") are bridged by the alias
 * overrides above.
 */
export function normalizeName(name: string): string {
  const text = stripAccents(name)
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ");
  return text
    .split(/\s+/)
    .filter((token) => token && !FILLER_TOKENS.has(token))
    .join(" ");
}

export function teamMatchKey(name: string): string {
  const key = normalizeName(name);
  return TEAM_ALIASES[key] ?? key;
}

export function leagueMatchKey(name: string): string {
  const key = normalizeName(name);
  return LEAGUE_ALIASES[key] ?? key;
}
