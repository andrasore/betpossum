"use client";

import { Badge, Card, Grid, Stack, Text } from "@chakra-ui/react";
import type { OddsEvent } from "@/types";

interface Props {
  events: OddsEvent[];
  selectedEventId: string | null;
  onToggle: (event: OddsEvent) => void;
}

export function OddsBoard({ events, selectedEventId, onToggle }: Props) {
  if (events.length === 0) {
    return (
      <Card.Root variant="outline">
        <Card.Body>
          <Text fontSize="sm" color="fg.muted" textAlign="center">
            Waiting for live odds…
          </Text>
        </Card.Body>
      </Card.Root>
    );
  }

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
