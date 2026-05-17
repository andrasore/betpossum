'use client';

import { Badge, Box, Button, Card, Grid, Stack, Text } from '@chakra-ui/react';
import type { OddsEvent } from '@/types';

interface Props {
  events: OddsEvent[];
  onSelect: (event: OddsEvent, selection: 'home' | 'away' | 'draw') => void;
}

export function OddsBoard({ events, onSelect }: Props) {
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
    <Stack gap={3}>
      {events.map((e) => (
        <Card.Root key={e.eventId}>
          <Card.Body>
            <Badge mb={3} textTransform="uppercase" letterSpacing="wide" fontSize="2xs">
              {e.sport}
            </Badge>
            <Grid templateColumns="repeat(3, 1fr)" gap={2}>
              <OddsButton label={e.homeTeam} odds={e.homeOdds} onClick={() => onSelect(e, 'home')} />
              {e.drawOdds > 0 ? (
                <OddsButton label="Draw" odds={e.drawOdds} onClick={() => onSelect(e, 'draw')} />
              ) : (
                <Box />
              )}
              <OddsButton label={e.awayTeam} odds={e.awayOdds} onClick={() => onSelect(e, 'away')} />
            </Grid>
          </Card.Body>
        </Card.Root>
      ))}
    </Stack>
  );
}

function OddsButton({ label, odds, onClick }: { label: string; odds: number; onClick: () => void }) {
  return (
    <Button
      variant="outline"
      onClick={onClick}
      h="auto"
      py={2}
      px={3}
      flexDirection="column"
      gap={0.5}
    >
      <Text
        fontSize="xs"
        fontWeight="medium"
        maxW="full"
        whiteSpace="nowrap"
        overflow="hidden"
        textOverflow="ellipsis"
      >
        {label}
      </Text>
      <Text fontSize="md" fontWeight="bold">
        {odds.toFixed(2)}
      </Text>
    </Button>
  );
}
