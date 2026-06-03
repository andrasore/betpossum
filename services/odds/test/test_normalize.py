"""Entity-normalization algorithm: sport slugging and the name/alias match keys
that drive cross-provider merging. Pure functions, no DB — the DB half (lookup,
create, link) is exercised in test_entities.py against a real Postgres.
"""

from odds.normalize import (
    league_match_key,
    normalize_name,
    slugify_sport,
    sport_title,
    team_match_key,
)


def test_slugify_sport_from_key_prefix() -> None:
    assert slugify_sport("soccer_epl") == "soccer"
    assert slugify_sport("basketball_nba") == "basketball"
    assert slugify_sport("americanfootball_nfl") == "american_football"
    # API-Football builds "soccer_<league id>"; the prefix still wins.
    assert slugify_sport("soccer_39") == "soccer"


def test_slugify_sport_prefers_group_when_given() -> None:
    assert slugify_sport("ignored", "American Football") == "american_football"
    assert slugify_sport("ignored", "Soccer") == "soccer"


def test_normalize_name_strips_filler_and_accents() -> None:
    assert normalize_name("Manchester City FC") == "manchester city"
    assert normalize_name("Atlético Madrid") == "atletico madrid"


def test_team_alias_collapses_provider_variants() -> None:
    # The whole point: short and long spellings reduce to one key so two
    # providers land on the same canonical team.
    assert team_match_key("Man City") == team_match_key("Manchester City")
    assert team_match_key("LA Lakers") == "los angeles lakers"


def test_league_alias_collapses_provider_variants() -> None:
    assert league_match_key("EPL") == league_match_key("Premier League")
    assert league_match_key("NBA") == "national basketball association"


def test_sport_title_falls_back_for_unseeded_sport() -> None:
    assert sport_title("american_football") == "American Football"
    assert sport_title("tennis") == "Tennis"
