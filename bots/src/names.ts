// Randomized, readable handles so a freshly-provisioned pool of bots shows up on
// the leaderboard with varied names rather than bot01/bot02/…

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

// `suffix` (e.g. the bot's index) keeps usernames/emails unique within a run
// even if the adjective/animal pair repeats.
export function generateName(suffix: number): GeneratedName {
  const firstName = pick(ADJECTIVES);
  const lastName = pick(ANIMALS);
  const rand = Math.floor(Math.random() * 1000);
  const username = `${firstName}${lastName}${suffix}${rand}`.toLowerCase();
  return {
    username,
    firstName,
    lastName,
    email: `${username}@bots.betpossum.local`,
  };
}
