'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Badge, Box, Card, Flex, Heading, Stack, Text } from '@chakra-ui/react';
import { Navbar } from '@/components/Navbar';
import { OddsBoard } from '@/components/OddsBoard';
import { BetSlip } from '@/components/BetSlip';
import { useOdds } from '@/hooks/useOdds';
import { useBets } from '@/hooks/useBets';
import { useBalance } from '@/hooks/useBalance';
import { useForceTheme } from '@/hooks/useForceTheme';
import { isAdmin } from '@/lib/keycloak';
import type { Bet, OddsEvent } from '@/types';

type Selection = { event: OddsEvent; choice: 'home' | 'away' | 'draw' } | null;

const statusPalette: Record<Bet['status'], string> = {
  won: 'green',
  lost: 'red',
  pending: 'gray',
  held: 'yellow',
};

export default function DashboardPage() {
  useForceTheme('dark');
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [selection, setSelection] = useState<Selection>(null);
  const odds = useOdds(token);
  const { data: bets, mutate } = useBets(token);
  const balance = useBalance(token);

  useEffect(() => {
    const t = localStorage.getItem('token');
    if (!t) { router.replace('/login'); return; }
    if (isAdmin(t)) { router.replace('/admin'); return; }
    setToken(t);
  }, [router]);

  if (!token) return null;

  return (
    <Flex direction="column" h="100vh">
      <Navbar balance={balance} />
      <Flex flex="1" overflow="hidden">
        <Box as="main" flex="1" overflowY="auto" p={6}>
          <Heading as="h2" size="md" mb={4}>Live Markets</Heading>
          <OddsBoard
            events={odds}
            onSelect={(event, choice) => setSelection({ event, choice })}
          />

          {bets && bets.length > 0 && (
            <Box mt={8}>
              <Heading as="h2" size="md" mb={3}>My Bets</Heading>
              <Stack gap={2}>
                {bets.map((bet) => (
                  <Card.Root key={bet.id}>
                    <Card.Body py={3}>
                      <Flex align="center" justify="space-between" gap={4}>
                        <Text fontSize="sm" fontWeight="medium" textTransform="capitalize">
                          {bet.selection} @ {Number(bet.odds).toFixed(2)}
                        </Text>
                        <Text fontSize="sm" color="fg.muted">
                          £{Number(bet.stake).toFixed(2)}
                        </Text>
                        <Badge colorPalette={statusPalette[bet.status]} textTransform="capitalize">
                          {bet.status}
                        </Badge>
                      </Flex>
                    </Card.Body>
                  </Card.Root>
                ))}
              </Stack>
            </Box>
          )}
        </Box>

        <Box as="aside" w="320px" borderLeftWidth="1px" borderColor="border" p={4} overflowY="auto">
          <BetSlip
            selection={selection}
            onPlaced={() => { setSelection(null); mutate(); }}
          />
        </Box>
      </Flex>
    </Flex>
  );
}
