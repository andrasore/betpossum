"use client";

import { Badge, Box, Card, Flex, Heading, Text } from "@radix-ui/themes";
import { useState } from "react";
import { BetSlip } from "@/components/BetSlip";
import { LeagueFilterBar } from "@/components/LeagueFilterBar";
import { Navbar } from "@/components/Navbar";
import { OddsBoard } from "@/components/OddsBoard";
import { SportFilterBar } from "@/components/SportFilterBar";
import { useBalance } from "@/hooks/useBalance";
import { useBets } from "@/hooks/useBets";
import { useInsufficientBalanceToast } from "@/hooks/useInsufficientBalanceToast";
import { useLeagues } from "@/hooks/useLeagues";
import { useOdds } from "@/hooks/useOdds";
import { useSports } from "@/hooks/useSports";
import { useAuth } from "@/lib/auth-context";
import type { Bet, OddsEvent } from "@/types";

type Choice = "home" | "away" | "draw";
type Selection = { event: OddsEvent; choice: Choice } | null;

const statusColor: Record<Bet["status"], "green" | "red" | "gray" | "yellow"> =
  {
    won: "green",
    lost: "red",
    pending: "gray",
    held: "yellow",
  };

export default function DashboardPage() {
  const { isAuthenticated, accessToken, login } = useAuth();
  const [selection, setSelection] = useState<Selection>(null);
  const [selectedSport, setSelectedSport] = useState<string | null>(null);
  const [selectedLeague, setSelectedLeague] = useState<number | null>(null);

  const sessionKey = accessToken;
  const sports = useSports();
  const leagues = useLeagues(selectedSport ?? undefined);
  const odds = useOdds(
    isAuthenticated,
    selectedSport ?? undefined,
    selectedLeague ?? undefined,
  );
  const { data: bets, mutate } = useBets(sessionKey);
  const balance = useBalance(sessionKey);
  useInsufficientBalanceToast(sessionKey);

  return (
    <Flex direction="column" style={{ height: "100vh" }}>
      <Navbar balance={balance} />
      <Flex flexGrow="1" overflow="hidden">
        <Box asChild flexGrow="1" p="6" style={{ overflowY: "auto" }}>
          <main>
            <Heading as="h2" size="4" mb="4">
              Live Markets
            </Heading>
            <SportFilterBar
              sports={sports}
              selected={selectedSport}
              onSelect={(slug) => {
                // Changing the sport clears the league: the prior league
                // belongs to a different sport, so it can't stay selected.
                setSelectedSport(slug);
                setSelectedLeague(null);
              }}
            />
            <LeagueFilterBar
              leagues={leagues}
              selected={selectedLeague}
              onSelect={(league) => {
                if (league === null) {
                  setSelectedLeague(null);
                  return;
                }
                // A league belongs to exactly one sport — auto-select its
                // parent sport so the two bars stay consistent (the league bar
                // then re-scopes to that sport with this chip still active).
                setSelectedLeague(league.id);
                setSelectedSport(league.sportSlug);
              }}
            />
            <OddsBoard
              events={odds}
              selectedEventId={selection?.event.eventId ?? null}
              onToggle={(event) =>
                setSelection((s) =>
                  s?.event.eventId === event.eventId
                    ? null
                    : { event, choice: "home" },
                )
              }
            />

            {isAuthenticated && bets && bets.length > 0 && (
              <Box mt="6">
                <Heading as="h2" size="4" mb="3">
                  My Bets
                </Heading>
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
              </Box>
            )}
          </main>
        </Box>

        <Box
          asChild
          width="600px"
          p="4"
          style={{
            borderLeft: "1px solid var(--gray-a5)",
            overflowY: "auto",
          }}
        >
          <aside>
            <BetSlip
              selection={selection}
              loggedIn={isAuthenticated}
              balance={balance}
              onChoiceChange={(choice) =>
                setSelection((s) => (s ? { ...s, choice } : s))
              }
              onPlaced={() => {
                setSelection(null);
                mutate();
              }}
              onLogin={() => login("/dashboard")}
            />
          </aside>
        </Box>
      </Flex>
    </Flex>
  );
}
