"use client";

import { Card, Flex, Grid, Text } from "@radix-ui/themes";
import type { StatsSummary as Summary } from "@/types";

function Tile({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color?: "green" | "red";
}) {
  return (
    <Card>
      <Flex direction="column" gap="1">
        <Text size="1" color="gray">
          {label}
        </Text>
        <Text size="5" weight="bold" color={color}>
          {value}
        </Text>
      </Flex>
    </Card>
  );
}

const signed = (n: number, suffix = "") =>
  `${n >= 0 ? "+" : ""}${n.toFixed(suffix === "%" ? 1 : 2)}${suffix}`;

// Personal betting summary derived from settled bets (GET /stats/me/summary).
export function StatsSummary({ summary }: { summary: Summary }) {
  const pnlColor = summary.netProfit >= 0 ? "green" : "red";
  return (
    <Grid
      columns={{ initial: "2", sm: "4" }}
      gap="3"
      data-testid="stats-summary"
    >
      <Tile
        label="Net P&L"
        value={`£${signed(summary.netProfit)}`}
        color={pnlColor}
      />
      <Tile
        label="ROI"
        value={signed(summary.roiPct, "%")}
        color={summary.roiPct >= 0 ? "green" : "red"}
      />
      <Tile label="Win rate" value={`${summary.winRatePct.toFixed(0)}%`} />
      <Tile
        label="Settled bets"
        value={`${summary.wins}/${summary.settledCount}`}
      />
    </Grid>
  );
}
