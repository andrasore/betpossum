'use client';

import { useState } from 'react';
import {
  Box,
  Button,
  Card,
  Field,
  Flex,
  NumberInput,
  Separator,
  Stack,
  Text,
} from '@chakra-ui/react';
import type { OddsEvent } from '@/types';
import { placeBet } from '@/lib/api';

interface Selection {
  event: OddsEvent;
  choice: 'home' | 'away' | 'draw';
}

interface Props {
  selection: Selection | null;
  onPlaced: () => void;
}

export function BetSlip({ selection, onPlaced }: Props) {
  const [stake, setStake] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!selection) {
    return (
      <Card.Root variant="outline">
        <Card.Body>
          <Text fontSize="sm" color="fg.muted" textAlign="center">
            Click any odds to build your bet slip.
          </Text>
        </Card.Body>
      </Card.Root>
    );
  }

  const { event, choice } = selection;
  const odds =
    choice === 'home' ? event.homeOdds : choice === 'away' ? event.awayOdds : event.drawOdds;
  const potentialReturn = stake ? (parseFloat(stake) * odds).toFixed(2) : '—';

  async function submit() {
    if (!stake || isNaN(Number(stake))) return;
    setLoading(true);
    setError(null);
    try {
      await placeBet({
        eventId: event.eventId,
        selection: choice,
        odds,
        stake: parseFloat(stake),
      });
      setStake('');
      onPlaced();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card.Root>
      <Card.Header pb={3}>
        <Card.Title fontSize="md">Bet Slip</Card.Title>
      </Card.Header>
      <Card.Body>
        <Stack gap={4}>
          <Box>
            <Text fontSize="sm" fontWeight="medium">
              {event.homeTeam} vs {event.awayTeam}
            </Text>
            <Text fontSize="xs" color="fg.muted" textTransform="capitalize">
              {choice} @ {odds.toFixed(2)}
            </Text>
          </Box>
          <Field.Root>
            <Field.Label>Stake (£)</Field.Label>
            <NumberInput.Root
              value={stake}
              onValueChange={(d) => setStake(d.value)}
              min={0}
              step={1}
              width="full"
            >
              <NumberInput.Control />
              <NumberInput.Input placeholder="0.00" />
            </NumberInput.Root>
          </Field.Root>
          <Separator />
          <Flex justify="space-between" fontSize="sm">
            <Text color="fg.muted">Potential return</Text>
            <Text fontWeight="semibold">£{potentialReturn}</Text>
          </Flex>
          {error && (
            <Text fontSize="xs" color="red.500">
              {error}
            </Text>
          )}
        </Stack>
      </Card.Body>
      <Card.Footer>
        <Button w="full" onClick={submit} loading={loading} disabled={!stake}>
          Place Bet
        </Button>
      </Card.Footer>
    </Card.Root>
  );
}
