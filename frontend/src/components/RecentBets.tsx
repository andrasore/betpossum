"use client";

import { Badge, Card, Flex, Heading, Text } from "@radix-ui/themes";
import Link from "next/link";
import { statusColor } from "@/lib/betDisplay";
import type { Bet } from "@/types";

const RECENT_LIMIT = 5;

type RecentBetsProps = {
  bets: Bet[];
};

// The authenticated user's most recent bets, rendered as the bottom section of
// the dashboard sidebar. Shows only the latest few (the full history lives on
// /my-bets); each row links there with the matching bet anchored. `bets` arrive
// newest-first from the API (placedAt DESC), so a head slice is "most recent".
export function RecentBets({ bets }: RecentBetsProps) {
  const recent = bets.slice(0, RECENT_LIMIT);
  return (
    <Flex direction="column" gap="3">
      <Heading as="h2" size="4">
        Recent Bets
      </Heading>
      {recent.length === 0 ? (
        <Text size="2" color="gray">
          No bets yet.
        </Text>
      ) : (
        <Flex direction="column" gap="2">
          {recent.map((bet) => (
            <Link
              key={bet.id}
              href={`/my-bets#bet-${bet.id}`}
              style={{ textDecoration: "none" }}
            >
              <Card
                data-testid={`bet-row-${bet.id}`}
                style={{ cursor: "pointer" }}
              >
                <Flex align="center" justify="between" gap="4">
                  <Text
                    size="2"
                    weight="medium"
                    style={{ textTransform: "capitalize" }}
                  >
                    {bet.selection} @ {Number(bet.odds).toFixed(2)}
                  </Text>
                  <Text size="2" color="gray">
                    £{Number(bet.stake).toFixed(2)}
                  </Text>
                  <Badge
                    color={statusColor[bet.status]}
                    style={{ textTransform: "capitalize" }}
                  >
                    {bet.status}
                  </Badge>
                </Flex>
              </Card>
            </Link>
          ))}
          <Link href="/my-bets" style={{ textDecoration: "none" }}>
            <Text size="2" color="indigo" data-testid="view-all-bets">
              View all bets →
            </Text>
          </Link>
        </Flex>
      )}
    </Flex>
  );
}
