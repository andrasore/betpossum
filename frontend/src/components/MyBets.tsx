"use client";

import { Badge, Card, Flex, Heading, Text } from "@radix-ui/themes";
import type { Bet } from "@/types";

const statusColor: Record<Bet["status"], "green" | "red" | "gray" | "yellow"> =
  {
    won: "green",
    lost: "red",
    pending: "gray",
    held: "yellow",
  };

type MyBetsProps = {
  bets: Bet[];
};

// The authenticated user's placed bets, rendered as the bottom section of the
// dashboard sidebar. Each row shows the selection, stake and settlement status.
export function MyBets({ bets }: MyBetsProps) {
  return (
    <Flex direction="column" gap="3">
      <Heading as="h2" size="4">
        My Bets
      </Heading>
      {bets.length === 0 ? (
        <Text size="2" color="gray">
          No bets yet.
        </Text>
      ) : (
        <Flex direction="column" gap="2">
          {bets.map((bet) => (
            <Card key={bet.id} data-testid={`bet-row-${bet.id}`}>
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
          ))}
        </Flex>
      )}
    </Flex>
  );
}
