// Bot identities. The Keycloak username/email are deterministic (bot0, bot1, …)
// so the service re-attaches to the same users on restart instead of
// provisioning a fresh pool (which would orphan the old bots and mint new play
// money). The display first/last name stays a random silly handle — it's fixed
// in Keycloak at first creation, so restarts keep whatever each bot was born as.

const ADJECTIVES = [
  "Lucky",
  "Sharp",
  "Bold",
  "Sly",
  "Cool",
  "Wild",
  "Swift",
  "Calm",
  "Brave",
  "Clever",
  "Sneaky",
  "Mighty",
];

const ANIMALS = [
  "Possum",
  "Fox",
  "Otter",
  "Badger",
  "Falcon",
  "Wolf",
  "Heron",
  "Lynx",
  "Magpie",
  "Stoat",
  "Raccoon",
  "Marten",
];

function pick<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

export interface GeneratedName {
  username: string;
  firstName: string;
  lastName: string;
  email: string;
}

export function generateName(index: number): GeneratedName {
  const username = `bot${index}`;
  return {
    username,
    firstName: pick(ADJECTIVES),
    lastName: pick(ANIMALS),
    email: `${username}@bots.betpossum.local`,
  };
}
