"use client";

import { Box, Card, Flex, Heading, Text } from "@radix-ui/themes";

// Cumulative net profit (£) over time. Placeholder dummy data for now — when
// real per-bet settlement history is wired up, swap this single array for a
// derived series and the rest of the component renders unchanged.
const SAMPLE_SERIES: { label: string; value: number }[] = [
  { label: "Mon", value: 0 },
  { label: "Tue", value: 12 },
  { label: "Wed", value: -8 },
  { label: "Thu", value: 5 },
  { label: "Fri", value: 22 },
  { label: "Sat", value: 14 },
  { label: "Sun", value: 38 },
];

// viewBox units; the SVG scales to its container via width="100%".
const VB_W = 560;
const VB_H = 200;
const PAD = 24;

function buildPath(series: { value: number }[]): {
  line: string;
  area: string;
  zeroY: number;
} {
  const values = series.map((p) => p.value);
  const max = Math.max(...values, 0);
  const min = Math.min(...values, 0);
  const range = max - min || 1;

  const x = (i: number) =>
    PAD + (i * (VB_W - 2 * PAD)) / Math.max(series.length - 1, 1);
  const y = (v: number) => VB_H - PAD - ((v - min) / range) * (VB_H - 2 * PAD);

  const points = series.map((p, i) => `${x(i)},${y(p.value)}`);
  const line = `M ${points.join(" L ")}`;
  const area = `${line} L ${x(series.length - 1)},${VB_H - PAD} L ${x(0)},${VB_H - PAD} Z`;
  return { line, area, zeroY: y(0) };
}

// Wins/losses over time. Dependency-free inline SVG; clearly flagged as sample
// data so it isn't mistaken for the user's real history.
export function BetsChart() {
  const { line, area, zeroY } = buildPath(SAMPLE_SERIES);
  return (
    <Card>
      <Flex direction="column" gap="3">
        <Flex align="baseline" justify="between" gap="3">
          <Heading as="h3" size="3">
            Wins &amp; losses over time
          </Heading>
          <Text size="1" color="gray">
            sample data
          </Text>
        </Flex>
        <Box>
          <svg
            viewBox={`0 0 ${VB_W} ${VB_H}`}
            width="100%"
            role="img"
            aria-label="Cumulative net profit over time (sample data)"
            style={{ display: "block" }}
          >
            <title>Cumulative net profit over time (sample data)</title>
            {/* Zero baseline */}
            <line
              x1={PAD}
              x2={VB_W - PAD}
              y1={zeroY}
              y2={zeroY}
              stroke="var(--gray-a6)"
              strokeWidth={1}
              strokeDasharray="4 4"
            />
            <path d={area} fill="var(--accent-a3)" />
            <path
              d={line}
              fill="none"
              stroke="var(--accent-9)"
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          </svg>
          <Flex justify="between" mt="1" px="2">
            {SAMPLE_SERIES.map((p) => (
              <Text key={p.label} size="1" color="gray">
                {p.label}
              </Text>
            ))}
          </Flex>
        </Box>
      </Flex>
    </Card>
  );
}
