"use client";

import {
  Box,
  Button,
  Card,
  Flex,
  Heading,
  SegmentedControl,
  Separator,
  Text,
  TextField,
} from "@radix-ui/themes";
import { LogIn } from "lucide-react";
import { useState } from "react";
import { placeBet } from "@/lib/api";
import type { OddsEvent } from "@/types";

type Choice = "home" | "away" | "draw";

interface Selection {
  event: OddsEvent;
  choice: Choice;
}

interface Props {
  selection: Selection | null;
  loggedIn: boolean;
  balance: number | null;
  onChoiceChange: (choice: Choice) => void;
  onPlaced: () => void;
  onLogin: () => void;
}

export function BetSlip({
  selection,
  loggedIn,
  balance,
  onChoiceChange,
  onPlaced,
  onLogin,
}: Props) {
  const [stake, setStake] = useState("");
  const [loading, setLoading] = useState(false);

  if (!selection) {
    return (
      <Card>
        <Text size="2" color="gray" align="center" as="p">
          Click any event to build your bet slip.
        </Text>
      </Card>
    );
  }

  const { event, choice } = selection;
  const homeLabel = event.homeTeamName ?? event.homeTeam;
  const awayLabel = event.awayTeamName ?? event.awayTeam;
  const odds =
    choice === "home"
      ? event.homeOdds
      : choice === "away"
        ? event.awayOdds
        : event.drawOdds;
  const stakeNum = parseFloat(stake);
  const stakeValid = stake !== "" && Number.isFinite(stakeNum) && stakeNum > 0;
  const overBalance = stakeValid && balance !== null && stakeNum > balance;
  const potentialReturn = stakeValid ? (stakeNum * odds).toFixed(2) : "—";

  const segments: { value: Choice; label: string; odds: number }[] = [
    { value: "home", label: homeLabel, odds: event.homeOdds },
    ...(event.drawOdds > 0
      ? [{ value: "draw" as Choice, label: "Draw", odds: event.drawOdds }]
      : []),
    { value: "away", label: awayLabel, odds: event.awayOdds },
  ];

  async function submit() {
    if (!stake || Number.isNaN(Number(stake))) {
      return;
    }
    setLoading(true);
    try {
      await placeBet({
        eventId: event.eventId,
        selection: choice,
        odds,
        stake: parseFloat(stake),
      });
      setStake("");
      onPlaced();
    } catch {
      // Failures surface via the insufficient-balance toast (or are logged
      // server-side for other errors).
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <Flex direction="column" gap="4">
        <Heading size="3">Bet Slip</Heading>
        <Box>
          <Text size="2" weight="medium" as="div">
            {homeLabel} vs {awayLabel}
          </Text>
          <Text
            size="1"
            color="gray"
            as="div"
            style={{ textTransform: "capitalize" }}
          >
            {choice} @ {odds.toFixed(2)}
          </Text>
        </Box>
        <Box
          style={loggedIn ? undefined : { opacity: 0.5, pointerEvents: "none" }}
        >
          <SegmentedControl.Root
            size="1"
            value={choice}
            onValueChange={(value) => {
              if (loggedIn && value) {
                onChoiceChange(value as Choice);
              }
            }}
            style={{ width: "100%", height: "var(--space-8)" }}
          >
            {segments.map((s) => (
              <SegmentedControl.Item key={s.value} value={s.value}>
                <Flex direction="column" align="center" gap="1">
                  <Text size="2" weight="medium">
                    {s.label}
                  </Text>
                  <Text size="1" weight="bold">
                    {s.odds.toFixed(2)}
                  </Text>
                </Flex>
              </SegmentedControl.Item>
            ))}
          </SegmentedControl.Root>
        </Box>
        <Box>
          <Text as="label" size="2" weight="medium" htmlFor="stake-input">
            Stake (£)
          </Text>
          <TextField.Root
            id="stake-input"
            data-testid="stake-input"
            type="number"
            value={stake}
            onChange={(e) => setStake(e.target.value)}
            min={0}
            max={balance ?? undefined}
            step={1}
            placeholder="0.00"
            disabled={!loggedIn}
            color={overBalance ? "red" : undefined}
            mt="1"
          />
          {overBalance && (
            <Text size="1" color="red" as="div" mt="1">
              Stake exceeds your balance of £{balance?.toFixed(2)}.
            </Text>
          )}
        </Box>
        <Separator size="4" />
        <Flex justify="between">
          <Text size="2" color="gray">
            Potential return
          </Text>
          <Text size="2" weight="medium">
            £{potentialReturn}
          </Text>
        </Flex>
        {loggedIn ? (
          <Button
            onClick={submit}
            loading={loading}
            disabled={!stakeValid || overBalance}
            data-testid="place-bet-button"
            style={{ width: "100%" }}
          >
            Place Bet
          </Button>
        ) : (
          <Button
            onClick={onLogin}
            data-testid="betslip-login-button"
            style={{ width: "100%" }}
          >
            <LogIn size={16} />
            Sign in to Place Bet
          </Button>
        )}
      </Flex>
    </Card>
  );
}
