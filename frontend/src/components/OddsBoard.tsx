"use client";

import { Badge, Card, Flex, Grid, Skeleton, Text } from "@radix-ui/themes";
import type { OddsEvent } from "@/types";

interface Props {
  events: OddsEvent[];
  selectedEventId: string | null;
  onToggle: (event: OddsEvent) => void;
}

const SKELETON_PLACEHOLDER_COUNT = 8;

const commenceFormatter = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

function formatCommenceTime(ms: number): string {
  return commenceFormatter.format(new Date(ms));
}

export function OddsBoard({ events, selectedEventId, onToggle }: Props) {
  return (
    <Grid columns="repeat(auto-fill, 200px)" gap="3">
      {events.length === 0 &&
        Array.from({ length: SKELETON_PLACEHOLDER_COUNT }).map((_, i) => (
          <Card
            // biome-ignore lint/suspicious/noArrayIndexKey: static placeholder list
            key={i}
            aria-busy="true"
            aria-label="Loading live odds"
          >
            <Skeleton width="56px" mb="3">
              <Badge size="1">sport</Badge>
            </Skeleton>
            <Flex direction="column" gap="1">
              <Skeleton width="70%">
                <Text size="2" weight="medium">
                  Home team
                </Text>
              </Skeleton>
              <Text size="1" color="gray">
                vs
              </Text>
              <Skeleton width="60%">
                <Text size="2" weight="medium">
                  Away team
                </Text>
              </Skeleton>
            </Flex>
            <Skeleton width="50%" mt="3">
              <Text size="1">Kickoff time</Text>
            </Skeleton>
          </Card>
        ))}
      {events.map((e) => {
        const selected = e.eventId === selectedEventId;
        return (
          <Card
            key={e.eventId}
            data-testid={`event-card-${e.eventId}`}
            onClick={() => onToggle(e)}
            style={{
              cursor: "pointer",
              transition: "outline-color 0.15s, background-color 0.15s",
              ...(selected
                ? {
                    outline: "1px solid var(--accent-9)",
                    background: "var(--accent-3)",
                  }
                : {}),
            }}
          >
            <Flex direction="column" align="start" gap="1" mb="3">
              <Badge
                size="1"
                style={{ textTransform: "uppercase", letterSpacing: "0.05em" }}
              >
                {e.sportName ?? e.sport}
              </Badge>
              {e.leagueName && (
                <Badge size="1" color="gray" variant="soft">
                  {e.leagueName}
                </Badge>
              )}
            </Flex>
            <Card>
              <Flex direction="column" gap="1">
                <Text size="2" weight="medium" align="left">
                  {e.homeTeamName ?? e.homeTeam}
                </Text>
                <Text size="1" color="gray" align="center">
                  vs
                </Text>
                <Text size="2" weight="medium" align="right">
                  {e.awayTeamName ?? e.awayTeam}
                </Text>
              </Flex>
            </Card>
            {e.commenceTime != null && (
              <Text as="div" size="1" color="gray" mt="4">
                {formatCommenceTime(e.commenceTime)}
              </Text>
            )}
          </Card>
        );
      })}
    </Grid>
  );
}
