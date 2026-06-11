"use client";

import { Box, Button, Flex, Heading, Text } from "@radix-ui/themes";
import { LogIn } from "lucide-react";
import { BetsChart } from "@/components/BetsChart";
import { BetsTable } from "@/components/BetsTable";
import { Navbar } from "@/components/Navbar";
import { useBalance } from "@/hooks/useBalance";
import { useBets } from "@/hooks/useBets";
import { useOddsIndex } from "@/hooks/useOddsIndex";
import { useAuth } from "@/lib/auth-context";

export default function MyBetsPage() {
  const { isAuthenticated, isLoading, accessToken, login } = useAuth();
  const sessionKey = accessToken;
  const { data: bets } = useBets(sessionKey);
  const oddsIndex = useOddsIndex(sessionKey);
  const balance = useBalance(sessionKey);

  return (
    <Flex direction="column" style={{ height: "100vh" }}>
      <Navbar balance={balance} />
      <Box asChild flexGrow="1" p="6" style={{ overflowY: "auto" }}>
        <main>
          <Heading as="h2" size="6" mb="5">
            My Bets
          </Heading>

          {isAuthenticated ? (
            <Flex direction="column" gap="6" style={{ maxWidth: 900 }}>
              <BetsChart />
              <BetsTable bets={bets ?? []} oddsIndex={oddsIndex} />
            </Flex>
          ) : isLoading ? null : (
            <Flex direction="column" align="start" gap="3">
              <Text size="2" color="gray">
                Sign in to see your bet history.
              </Text>
              <Button
                size="2"
                onClick={() => login("/my-bets")}
                data-testid="mybets-login-button"
              >
                <LogIn size={16} />
                Sign in
              </Button>
            </Flex>
          )}
        </main>
      </Box>
    </Flex>
  );
}
