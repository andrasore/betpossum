"use client";

import { Card, Flex, Heading, Text } from "@radix-ui/themes";

type LeaderboardEntry = {
  rank: number;
  player: string;
  // Return on investment as a percentage of the player's total cash.
  roi: number;
};

// Placeholder standings until a real ROI leaderboard endpoint exists. Sorted by
// ROI descending so the row order already matches the displayed ranks.
const DUMMY_ENTRIES: LeaderboardEntry[] = [
  { rank: 1, player: "PossumKing", roi: 42.7 },
  { rank: 2, player: "LongShotLucy", roi: 31.4 },
  { rank: 3, player: "TheAccumulator", roi: 27.9 },
  { rank: 4, player: "ColdDeckCarl", roi: 18.2 },
  { rank: 5, player: "ParlayPete", roi: 12.6 },
  { rank: 6, player: "HedgeHog", roi: 7.1 },
  { rank: 7, player: "TiltMaster", roi: -4.3 },
];

// Top player ROIs (return as a percentage of total cash), shown as the top
// section of the dashboard sidebar. Currently backed by dummy data.
export function Leaderboard() {
  return (
    <Flex direction="column" gap="3" data-testid="leaderboard">
      <Heading as="h2" size="4">
        Leaderboard
      </Heading>
      <Flex direction="column" gap="2">
        {DUMMY_ENTRIES.map((entry) => (
          <Card key={entry.rank} data-testid={`leaderboard-row-${entry.rank}`}>
            <Flex align="center" justify="between" gap="3">
              <Flex align="center" gap="3" minWidth="0">
                <Text size="2" color="gray" weight="medium">
                  {entry.rank}
                </Text>
                <Text size="2" weight="medium" truncate>
                  {entry.player}
                </Text>
              </Flex>
              <Text
                size="2"
                weight="bold"
                color={entry.roi >= 0 ? "green" : "red"}
              >
                {entry.roi >= 0 ? "+" : ""}
                {entry.roi.toFixed(1)}%
              </Text>
            </Flex>
          </Card>
        ))}
      </Flex>
    </Flex>
  );
}
