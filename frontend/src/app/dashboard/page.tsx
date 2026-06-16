"use client";

import { Box, Flex, Heading } from "@radix-ui/themes";
import { useState } from "react";
import { BetSlipDrawer } from "@/components/BetSlipDrawer";
import { Leaderboard } from "@/components/Leaderboard";
import { LeagueFilterBar } from "@/components/LeagueFilterBar";
import { Navbar } from "@/components/Navbar";
import { OddsBoard } from "@/components/OddsBoard";
import { RecentBets } from "@/components/RecentBets";
import { SportFilterBar } from "@/components/SportFilterBar";
import { useBalance } from "@/hooks/useBalance";
import { useBets } from "@/hooks/useBets";
import { useDashboardFilters } from "@/hooks/useDashboardFilters";
import { useLeagues } from "@/hooks/useLeagues";
import { useOdds } from "@/hooks/useOdds";
import { useSports } from "@/hooks/useSports";
import { useAuth } from "@/lib/auth-context";
import type { OddsEvent } from "@/types";

type Choice = "home" | "away" | "draw";
type Selection = { event: OddsEvent; choice: Choice } | null;

export default function DashboardPage() {
  const { isAuthenticated, accessToken, login } = useAuth();
  const [selection, setSelection] = useState<Selection>(null);
  const { selectedSport, selectedLeague, selectSport, selectLeague } =
    useDashboardFilters();

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
              onSelect={selectSport}
            />
            <LeagueFilterBar
              leagues={leagues}
              selected={selectedLeague}
              onSelect={selectLeague}
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
          </main>
        </Box>

        <Box
          asChild
          width="320px"
          flexShrink="0"
          p="6"
          style={{
            borderLeft: "1px solid var(--gray-a5)",
            overflowY: "auto",
          }}
        >
          <aside>
            <Flex direction="column" gap="6">
              <Leaderboard />
              {isAuthenticated && bets && <RecentBets bets={bets} />}
            </Flex>
          </aside>
        </Box>
      </Flex>

      <BetSlipDrawer
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
        onClose={() => setSelection(null)}
      />
    </Flex>
  );
}
