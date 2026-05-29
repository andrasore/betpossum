"use client";

import { Badge, Card, Flex, Grid, Skeleton, Text } from "@radix-ui/themes";
import type { OddsEvent } from "@/types";

interface Props {
  events: OddsEvent[];
  selectedEventId: string | null;
  onToggle: (event: OddsEvent) => void;
}

const SKELETON_PLACEHOLDER_COUNT = 8;

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
            <Badge
              size="1"
              mb="3"
              style={{ textTransform: "uppercase", letterSpacing: "0.05em" }}
            >
              {e.sport}
            </Badge>
            <Flex direction="column" gap="1">
              <Text size="2" weight="medium">
                {e.homeTeam}
              </Text>
              <Text size="1" color="gray">
                vs
              </Text>
              <Text size="2" weight="medium">
                {e.awayTeam}
              </Text>
            </Flex>
          </Card>
        );
      })}
    </Grid>
  );
}
