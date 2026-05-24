"use client";

import { Badge, Box, Card, Flex, Heading, Stack, Text } from "@chakra-ui/react";
import { signIn, useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { BetSlip } from "@/components/BetSlip";
import { Navbar } from "@/components/Navbar";
import { OddsBoard } from "@/components/OddsBoard";
import { useBalance } from "@/hooks/useBalance";
import { useBets } from "@/hooks/useBets";
import { useForceTheme } from "@/hooks/useForceTheme";
import { useInsufficientBalanceToast } from "@/hooks/useInsufficientBalanceToast";
import { useOdds } from "@/hooks/useOdds";
import type { Bet, OddsEvent } from "@/types";

type Choice = "home" | "away" | "draw";
type Selection = { event: OddsEvent; choice: Choice } | null;

const statusPalette: Record<Bet["status"], string> = {
  won: "green",
  lost: "red",
  pending: "gray",
  held: "yellow",
};

export default function DashboardPage() {
  useForceTheme("dark");
  const router = useRouter();
  const { data: session, status } = useSession();
  const [selection, setSelection] = useState<Selection>(null);

  // Hooks below use the session token as a "logged in?" key, not as a
  // credential — the actual token never leaves the BFF.
  const sessionKey = session?.accessToken ?? null;
  const odds = useOdds(sessionKey !== null);
  const { data: bets, mutate } = useBets(sessionKey);
  const balance = useBalance(sessionKey);
  useInsufficientBalanceToast(sessionKey);

  useEffect(() => {
    if (status !== "authenticated") return;
    if (session.roles.includes("admin")) router.replace("/admin");
  }, [status, session, router]);

  const loggedIn = status === "authenticated";

  return (
    <Flex direction="column" h="100vh">
      <Navbar balance={balance} loggedIn={loggedIn} />
      <Flex flex="1" overflow="hidden">
        <Box as="main" flex="1" overflowY="auto" p={6}>
          <Heading as="h2" size="md" mb={4}>
            Live Markets
          </Heading>
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

          {loggedIn && bets && bets.length > 0 && (
            <Box mt={8}>
              <Heading as="h2" size="md" mb={3}>
                My Bets
              </Heading>
              <Stack gap={2}>
                {bets.map((bet) => (
                  <Card.Root key={bet.id} data-testid={`bet-row-${bet.id}`}>
                    <Card.Body py={3}>
                      <Flex align="center" justify="space-between" gap={4}>
                        <Text
                          fontSize="sm"
                          fontWeight="medium"
                          textTransform="capitalize"
                        >
                          {bet.selection} @ {Number(bet.odds).toFixed(2)}
                        </Text>
                        <Text fontSize="sm" color="fg.muted">
                          £{Number(bet.stake).toFixed(2)}
                        </Text>
                        <Badge
                          colorPalette={statusPalette[bet.status]}
                          textTransform="capitalize"
                        >
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

        <Box
          as="aside"
          w="600px"
          borderLeftWidth="1px"
          borderColor="border"
          p={4}
          overflowY="auto"
        >
          <BetSlip
            selection={selection}
            loggedIn={loggedIn}
            balance={balance}
            onChoiceChange={(choice) =>
              setSelection((s) => (s ? { ...s, choice } : s))
            }
            onPlaced={() => {
              setSelection(null);
              mutate();
            }}
            onLogin={() => {
              void signIn("keycloak", { callbackUrl: "/dashboard" });
            }}
          />
        </Box>
      </Flex>
    </Flex>
  );
}
