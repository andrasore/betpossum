"use client";

import { Card, Flex, Heading, Text } from "@radix-ui/themes";
import { useLeaderboard } from "@/hooks/useStats";
import type { LeaderboardEntry } from "@/types";

function displayName(entry: LeaderboardEntry): string {
  return entry.userName ?? `Player ${entry.userId.slice(0, 6)}`;
}

// Top players by ROI (return as a percentage of total staked), shown at the top
// of the dashboard sidebar. Backed by the stats service; entries are ranked by
// ROI descending so row order matches the displayed rank.
export function Leaderboard({ token }: { token: string | null }) {
  const { data: entries } = useLeaderboard(token);

  return (
    <Flex direction="column" gap="3" data-testid="leaderboard">
      <Heading as="h2" size="4">
        Leaderboard
      </Heading>
      {entries && entries.length === 0 ? (
        <Text size="2" color="gray">
          No ranked players yet.
        </Text>
      ) : (
        <Flex direction="column" gap="2">
          {(entries ?? []).map((entry, i) => {
            const rank = i + 1;
            return (
              <Card key={entry.userId} data-testid={`leaderboard-row-${rank}`}>
                <Flex align="center" justify="between" gap="3">
                  <Flex align="center" gap="3" minWidth="0">
                    <Text size="2" color="gray" weight="medium">
                      {rank}
                    </Text>
                    <Text size="2" weight="medium" truncate>
                      {displayName(entry)}
                    </Text>
                  </Flex>
                  <Text
                    size="2"
                    weight="bold"
                    color={entry.roiPct >= 0 ? "green" : "red"}
                  >
                    {entry.roiPct >= 0 ? "+" : ""}
                    {entry.roiPct.toFixed(1)}%
                  </Text>
                </Flex>
              </Card>
            );
          })}
        </Flex>
      )}
    </Flex>
  );
}
