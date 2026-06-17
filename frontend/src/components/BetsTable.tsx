"use client";

import { Badge, Flex, Table, Text } from "@radix-ui/themes";
import { useEffect, useRef, useState } from "react";
import { betOutcomeLabel, selectionLabel, statusColor } from "@/lib/betDisplay";
import { sportColor } from "@/lib/sportColor";
import type { Bet, OddsEvent } from "@/types";

type BetsTableProps = {
  bets: Bet[];
  oddsIndex: Map<string, OddsEvent>;
};

const HIGHLIGHT_MS = 2000;

// Full, enriched bet history. Each bet carries only an `eventId`; we join
// against `oddsIndex` to surface the league/sport and team names. The join may
// miss (odds still loading, or an event long gone) — every cell falls back
// rather than crashing.
export function BetsTable({ bets, oddsIndex }: BetsTableProps) {
  // Deep-link target from `/my-bets#bet-<id>`: scroll it into view and flash a
  // highlight. Read from the hash in an effect (not useSearchParams) so the
  // static export builds without a Suspense boundary.
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  // Guard so we scroll/flash the deep-linked row exactly once, not on every
  // later bets revalidation (a settlement would otherwise yank the user back).
  const handledHashRef = useRef(false);
  useEffect(() => {
    if (handledHashRef.current) {
      return;
    }
    const match = window.location.hash.match(/^#bet-(.+)$/);
    if (!match) {
      return;
    }
    const id = match[1];
    const row = document.getElementById(`bet-${id}`);
    if (!row) {
      // Rows aren't mounted yet (history fetch still resolving); a later bets
      // update re-runs this effect, by which point the row exists.
      return;
    }
    handledHashRef.current = true;
    row.scrollIntoView({ block: "center", behavior: "smooth" });
    setHighlightedId(id);
    const timer = setTimeout(() => setHighlightedId(null), HIGHLIGHT_MS);
    return () => clearTimeout(timer);
  }, [bets]);

  if (bets.length === 0) {
    return (
      <Text size="2" color="gray">
        No bets yet.
      </Text>
    );
  }

  return (
    <Table.Root size="1" variant="surface">
      <Table.Header>
        <Table.Row>
          <Table.ColumnHeaderCell>League / Sport</Table.ColumnHeaderCell>
          <Table.ColumnHeaderCell>Teams</Table.ColumnHeaderCell>
          <Table.ColumnHeaderCell>Bet</Table.ColumnHeaderCell>
          <Table.ColumnHeaderCell justify="end">Stake</Table.ColumnHeaderCell>
          <Table.ColumnHeaderCell>Outcome</Table.ColumnHeaderCell>
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {bets.map((bet) => {
          const event = oddsIndex.get(bet.eventId);
          const highlighted = bet.id === highlightedId;
          return (
            <Table.Row
              key={bet.id}
              id={`bet-${bet.id}`}
              data-testid={`bet-row-${bet.id}`}
              style={
                highlighted
                  ? {
                      outline: "1px solid var(--accent-9)",
                      background: "var(--accent-3)",
                    }
                  : undefined
              }
            >
              <Table.Cell>
                {event ? (
                  <Flex direction="column" align="start" gap="1">
                    <Text size="2" weight="medium">
                      {event.leagueName ?? "—"}
                    </Text>
                    <Badge
                      size="1"
                      color={sportColor(event.sport)}
                      style={{
                        textTransform: "uppercase",
                        letterSpacing: "0.05em",
                      }}
                    >
                      {event.sportName ?? event.sport}
                    </Badge>
                  </Flex>
                ) : (
                  <Text size="2" color="gray">
                    —
                  </Text>
                )}
              </Table.Cell>
              <Table.Cell>
                {event ? (
                  <Text size="2">
                    {event.homeTeamName ?? event.homeTeam} vs{" "}
                    {event.awayTeamName ?? event.awayTeam}
                  </Text>
                ) : (
                  <Text size="2" color="gray">
                    {bet.eventId}
                  </Text>
                )}
              </Table.Cell>
              <Table.Cell>
                <Text size="2" style={{ textTransform: "capitalize" }}>
                  {selectionLabel(bet, event)} @ {Number(bet.odds).toFixed(2)}
                </Text>
              </Table.Cell>
              <Table.Cell justify="end">
                <Text size="2">£{Number(bet.stake).toFixed(2)}</Text>
              </Table.Cell>
              <Table.Cell>
                <Badge
                  color={statusColor[bet.status]}
                  style={{ textTransform: "capitalize" }}
                >
                  {betOutcomeLabel(bet)}
                </Badge>
              </Table.Cell>
            </Table.Row>
          );
        })}
      </Table.Body>
    </Table.Root>
  );
}
