/**
 * Entity-normalization algorithm: sport slugging and the name/alias match keys
 * that drive cross-provider merging. Pure functions, no DB — the DB half
 * (lookup, create, link) is exercised in postgres.storage.spec.ts against a
 * real Postgres.
 */
import {
  leagueMatchKey,
  normalizeName,
  slugifySport,
  sportTitle,
  teamMatchKey,
} from "./normalize";

describe("slugifySport", () => {
  it("takes the sport from the key prefix", () => {
    expect(slugifySport("soccer_epl")).toBe("soccer");
    expect(slugifySport("basketball_nba")).toBe("basketball");
    expect(slugifySport("americanfootball_nfl")).toBe("american_football");
    // API-Football builds "soccer_<league id>"; the prefix still wins.
    expect(slugifySport("soccer_39")).toBe("soccer");
  });

  it("prefers the group when given", () => {
    expect(slugifySport("ignored", "American Football")).toBe(
      "american_football",
    );
    expect(slugifySport("ignored", "Soccer")).toBe("soccer");
  });
});

describe("normalizeName", () => {
  it("strips filler tokens and accents", () => {
    expect(normalizeName("Manchester City FC")).toBe("manchester city");
    expect(normalizeName("Atlético Madrid")).toBe("atletico madrid");
  });
});

describe("match keys", () => {
  it("collapses team spelling variants across providers", () => {
    // The whole point: short and long spellings reduce to one key so two
    // providers land on the same canonical team.
    expect(teamMatchKey("Man City")).toBe(teamMatchKey("Manchester City"));
    expect(teamMatchKey("LA Lakers")).toBe("los angeles lakers");
  });

  it("collapses league name variants across providers", () => {
    expect(leagueMatchKey("EPL")).toBe(leagueMatchKey("Premier League"));
    expect(leagueMatchKey("NBA")).toBe("national basketball association");
  });
});

describe("sportTitle", () => {
  it("falls back to a title-cased slug for an unseeded sport", () => {
    expect(sportTitle("american_football")).toBe("American Football");
    expect(sportTitle("tennis")).toBe("Tennis");
  });
});
