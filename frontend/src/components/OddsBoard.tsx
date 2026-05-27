"use client";

import { Badge, Card, Grid, Skeleton, Stack, Text } from "@chakra-ui/react";
import type { OddsEvent } from "@/types";

interface Props {
  events: OddsEvent[];
  selectedEventId: string | null;
  onToggle: (event: OddsEvent) => void;
}

const SKELETON_PLACEHOLDER_COUNT = 8;

export function OddsBoard({ events, selectedEventId, onToggle }: Props) {
  return (
    <Grid
      templateColumns={{
        base: "1fr",
        sm: "repeat(2, 1fr)",
        md: "repeat(3, 1fr)",
        lg: "repeat(4, 1fr)",
      }}
      gap={3}
    >
      {events.length === 0 &&
        Array.from({ length: SKELETON_PLACEHOLDER_COUNT }).map((_, i) => (
          <Card.Root
            // biome-ignore lint/suspicious/noArrayIndexKey: static placeholder list
            key={i}
            data-testid="event-card-skeleton"
            aria-busy="true"
            aria-label="Loading live odds"
          >
            <Card.Body>
              <Skeleton asChild mb={3} width="14">
                <Badge
                  textTransform="uppercase"
                  letterSpacing="wide"
                  fontSize="2xs"
                >
                  sport
                </Badge>
              </Skeleton>
              <Stack gap={1}>
                <Skeleton asChild width="70%">
                  <Text fontSize="sm" fontWeight="medium">
                    Home team
                  </Text>
                </Skeleton>
                <Text fontSize="xs" color="fg.muted">
                  vs
                </Text>
                <Skeleton asChild width="60%">
                  <Text fontSize="sm" fontWeight="medium">
                    Away team
                  </Text>
                </Skeleton>
              </Stack>
            </Card.Body>
          </Card.Root>
        ))}
      {events.map((e) => {
        const selected = e.eventId === selectedEventId;
        return (
          <Card.Root
            key={e.eventId}
            data-testid={`event-card-${e.eventId}`}
            cursor="pointer"
            onClick={() => onToggle(e)}
            borderColor={selected ? "blue.500" : undefined}
            bg={selected ? "bg.subtle" : undefined}
            _hover={{
              borderColor: selected ? "blue.500" : "border.emphasized",
            }}
            transition="border-color 0.15s, background-color 0.15s"
          >
            <Card.Body>
              <Badge
                mb={3}
                textTransform="uppercase"
                letterSpacing="wide"
                fontSize="2xs"
              >
                {e.sport}
              </Badge>
              <Stack gap={1}>
                <Text fontSize="sm" fontWeight="medium">
                  {e.homeTeam}
                </Text>
                <Text fontSize="xs" color="fg.muted">
                  vs
                </Text>
                <Text fontSize="sm" fontWeight="medium">
                  {e.awayTeam}
                </Text>
              </Stack>
            </Card.Body>
          </Card.Root>
        );
      })}
    </Grid>
  );
}
