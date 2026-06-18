"use client";

import { Badge, Card, Flex, Grid, Spinner, Text } from "@radix-ui/themes";
import { sportColor } from "@/lib/sportColor";
import type { OddsEvent } from "@/types";

interface Props {
  events: OddsEvent[];
  selectedEventId: string | null;
  onToggle: (event: OddsEvent) => void;
  isLoading: boolean;
}

const commenceFormatter = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

function formatCommenceTime(ms: number): string {
  return commenceFormatter.format(new Date(ms));
}

export function OddsBoard({
  events,
  selectedEventId,
  onToggle,
  isLoading,
}: Props) {
  // Active (still bettable) events first; resolved ones sink to the bottom.
  // Copy before sorting so we don't mutate the prop, and keep it stable so the
  // server's within-group ordering survives.
  const ordered = events
    .map((e, i) => [e, i] as const)
    .sort(([a, ai], [b, bi]) => {
      const ar = a.outcome != null ? 1 : 0;
      const br = b.outcome != null ? 1 : 0;
      return ar - br || ai - bi;
    })
    .map(([e]) => e);

  if (isLoading && events.length === 0) {
    return (
      <Flex
        align="center"
        justify="center"
        py="9"
        aria-busy="true"
        aria-label="Loading live odds"
      >
        <Spinner size="3" />
      </Flex>
    );
  }

  return (
    <Grid columns="repeat(auto-fill, 200px)" gap="3">
      {ordered.map((e) => {
        const selected = e.eventId === selectedEventId;
        // A resolved event (outcome set by the odds service) can no longer be
        // bet on — settlement has already happened, so the bet would never
        // settle. Render it inert: no click, dimmed, with a "Final" badge.
        const resolved = e.outcome != null;
        const winnerLabel =
          e.outcome === "home"
            ? (e.homeTeamName ?? e.homeTeam)
            : e.outcome === "away"
              ? (e.awayTeamName ?? e.awayTeam)
              : "Draw";
        return (
          <Card
            key={e.eventId}
            data-testid={`event-card-${e.eventId}`}
            aria-disabled={resolved || undefined}
            onClick={resolved ? undefined : () => onToggle(e)}
            style={{
              cursor: resolved ? "not-allowed" : "pointer",
              opacity: resolved ? 0.55 : undefined,
              transition: "outline-color 0.15s, background-color 0.15s",
              ...(selected
                ? {
                    outline: "1px solid var(--accent-9)",
                    background: "var(--accent-3)",
                  }
                : {}),
            }}
          >
            <Flex direction="column" align="start" gap="1" mb="3">
              {e.leagueName && (
                <Badge size="3" color={sportColor(e.sport)} variant="soft">
                  {e.leagueName}
                </Badge>
              )}
              <Badge
                size="1"
                color={sportColor(e.sport)}
                style={{ textTransform: "uppercase", letterSpacing: "0.05em" }}
              >
                {e.sportName ?? e.sport}
              </Badge>
            </Flex>
            <Card>
              <Flex direction="column" gap="1">
                <Text size="2" weight="medium" align="left">
                  {e.homeTeamName ?? e.homeTeam}
                </Text>
                <Text size="1" color="gray" align="center">
                  vs
                </Text>
                <Text size="2" weight="medium" align="right">
                  {e.awayTeamName ?? e.awayTeam}
                </Text>
              </Flex>
            </Card>
            {resolved ? (
              <Flex align="center" gap="2" mt="4">
                <Badge size="1" color="gray" variant="solid">
                  Final
                </Badge>
                <Text size="1" color="gray">
                  {winnerLabel}
                </Text>
              </Flex>
            ) : (
              e.commenceTime != null && (
                <Text as="div" size="1" color="gray" mt="4">
                  {formatCommenceTime(e.commenceTime)}
                </Text>
              )
            )}
          </Card>
        );
      })}
    </Grid>
  );
}
