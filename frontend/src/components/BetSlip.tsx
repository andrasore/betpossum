"use client";

import {
  Box,
  Button,
  Card,
  Field,
  Flex,
  NumberInput,
  SegmentGroup,
  Separator,
  Stack,
  Text,
} from "@chakra-ui/react";
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
      <Card.Root variant="outline">
        <Card.Body>
          <Text fontSize="sm" color="fg.muted" textAlign="center">
            Click any event to build your bet slip.
          </Text>
        </Card.Body>
      </Card.Root>
    );
  }

  const { event, choice } = selection;
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
    { value: "home", label: event.homeTeam, odds: event.homeOdds },
    ...(event.drawOdds > 0
      ? [{ value: "draw" as Choice, label: "Draw", odds: event.drawOdds }]
      : []),
    { value: "away", label: event.awayTeam, odds: event.awayOdds },
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
          <SegmentGroup.Root
            size="sm"
            width="full"
            value={choice}
            disabled={!loggedIn}
            onValueChange={(d) => {
              if (d.value) {
                onChoiceChange(d.value as Choice);
              }
            }}
          >
            <SegmentGroup.Indicator />
            <SegmentGroup.Items
              items={segments.map((s) => ({
                value: s.value,
                label: (
                  <Stack gap={0.5} align="center">
                    <Text fontSize="sm" fontWeight="medium">
                      {s.label}
                    </Text>
                    <Text fontSize="xs" fontWeight="bold">
                      {s.odds.toFixed(2)}
                    </Text>
                  </Stack>
                ),
              }))}
              flex="1"
              height="16"
              justifyContent="center"
            />
          </SegmentGroup.Root>
          <Field.Root invalid={overBalance}>
            <Field.Label>Stake (£)</Field.Label>
            <NumberInput.Root
              value={stake}
              onValueChange={(d) => setStake(d.value)}
              min={0}
              max={balance ?? undefined}
              clampValueOnBlur
              step={1}
              width="full"
              disabled={!loggedIn}
            >
              <NumberInput.Control />
              <NumberInput.Input placeholder="0.00" data-testid="stake-input" />
            </NumberInput.Root>
            {overBalance && (
              <Field.ErrorText>
                Stake exceeds your balance of £{balance?.toFixed(2)}.
              </Field.ErrorText>
            )}
          </Field.Root>
          <Separator />
          <Flex justify="space-between" fontSize="sm">
            <Text color="fg.muted">Potential return</Text>
            <Text fontWeight="semibold">£{potentialReturn}</Text>
          </Flex>
        </Stack>
      </Card.Body>
      <Card.Footer>
        {loggedIn ? (
          <Button
            w="full"
            onClick={submit}
            loading={loading}
            disabled={!stakeValid || overBalance}
            data-testid="place-bet-button"
          >
            Place Bet
          </Button>
        ) : (
          <Button w="full" onClick={onLogin} data-testid="betslip-login-button">
            <LogIn size={16} />
            Sign in to Place Bet
          </Button>
        )}
      </Card.Footer>
    </Card.Root>
  );
}
