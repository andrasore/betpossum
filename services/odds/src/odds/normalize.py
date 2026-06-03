"""Pure helpers for normalizing provider sport/league/team identities.

No DB access — this is the *matching algorithm*. The lookup/create/link against
Postgres lives in `storage.postgres`; here we only turn a provider's labels into
a canonical sport slug and into comparable match keys, plus a small seeded set
of cross-provider alias overrides for the gaps plain name-normalization can't
bridge ("Man City" vs "Manchester City", "EPL" vs "Premier League").

Matching is scoped by sport: leagues/teams are compared within a `sport_slug`,
never globally, so a name collision across sports can't merge two entities.
Country is enrichment, **not** part of the match key — one provider (The Odds
API) gives no country at all, so requiring it would defeat cross-provider league
matching, which is the whole point.
"""

import re
import unicodedata

# ── Sport ────────────────────────────────────────────────────────────────────

# Canonical sport slug -> display title. Seeded; new sports extend this.
SPORT_TITLES: dict[str, str] = {
    "soccer": "Soccer",
    "basketball": "Basketball",
    "american_football": "American Football",
}

# Provider sport labels (The Odds API `group`, or a `sport_key` prefix) -> slug.
# API-Football's product *is* soccer, so its "football" collapses to "soccer".
_SPORT_ALIASES: dict[str, str] = {
    "soccer": "soccer",
    "football": "soccer",
    "basketball": "basketball",
    "americanfootball": "american_football",
    "american football": "american_football",
}


def _slugify(text: str) -> str:
    text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "_", text.lower()).strip("_")


def slugify_sport(source_key: str, group: str | None = None) -> str:
    """Map a provider's sport label to a canonical slug.

    `group` is The Odds API's broad bucket ("Soccer", "American Football") when
    available; `source_key` is the provider's sport identifier ("soccer_epl",
    "basketball_nba", or API-Football's "soccer_39"). For both odds-style keys
    the prefix before the first underscore is the broad sport.
    """
    if group:
        slug = _SPORT_ALIASES.get(group.strip().lower())
        if slug:
            return slug
    prefix = source_key.split("_", 1)[0].strip().lower()
    return _SPORT_ALIASES.get(prefix, _slugify(prefix))


def sport_title(slug: str) -> str:
    return SPORT_TITLES.get(slug, slug.replace("_", " ").title())


# ── Name matching ────────────────────────────────────────────────────────────

# Tokens that carry no identity and only add noise to a name match.
_FILLER_TOKENS = {"fc", "afc", "cf", "sc", "club"}

# Cross-provider name gaps that normalization alone can't close. Keyed by the
# normalized *variant* -> the normalized canonical key it should collapse to.
# Keep entries unambiguous within a sport; extend as new mismatches surface.
_TEAM_ALIASES: dict[str, str] = {
    "man city": "manchester city",
    "man utd": "manchester united",
    "man united": "manchester united",
    "la lakers": "los angeles lakers",
    "ny giants": "new york giants",
    "sf 49ers": "san francisco 49ers",
}

_LEAGUE_ALIASES: dict[str, str] = {
    "epl": "premier league",
    "soccer epl": "premier league",
    "nba": "national basketball association",
    "nfl": "national football league",
}


def normalize_name(name: str) -> str:
    """Reduce a team/league name to a comparable match key.

    Lowercases, strips accents and punctuation, and drops filler tokens so
    "Manchester City FC" and "manchester city" collapse to one key. This is the
    cheap match; gaps that survive it ("Man City") are bridged by the alias
    overrides above.
    """
    text = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode()
    text = re.sub(r"[^a-z0-9\s]+", " ", text.lower())
    tokens = [t for t in text.split() if t and t not in _FILLER_TOKENS]
    return " ".join(tokens)


def team_match_key(name: str) -> str:
    key = normalize_name(name)
    return _TEAM_ALIASES.get(key, key)


def league_match_key(name: str) -> str:
    key = normalize_name(name)
    return _LEAGUE_ALIASES.get(key, key)
