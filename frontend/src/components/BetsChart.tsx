"use client";

import { Box, Card, Flex, Heading, Text } from "@radix-ui/themes";
import type { PnlPoint } from "@/types";

// viewBox units; the SVG scales to its container via width="100%".
const VB_W = 560;
const VB_H = 200;
const PAD = 24;

function buildPath(series: PnlPoint[]): {
  line: string;
  area: string;
  zeroY: number;
} {
  const values = series.map((p) => p.roiPct);
  const max = Math.max(...values, 0);
  const min = Math.min(...values, 0);
  const range = max - min || 1;

  const x = (i: number) =>
    PAD + (i * (VB_W - 2 * PAD)) / Math.max(series.length - 1, 1);
  const y = (v: number) => VB_H - PAD - ((v - min) / range) * (VB_H - 2 * PAD);

  const points = series.map((p, i) => `${x(i)},${y(p.roiPct)}`);
  const line = `M ${points.join(" L ")}`;
  const area = `${line} L ${x(series.length - 1)},${VB_H - PAD} L ${x(0)},${VB_H - PAD} Z`;
  return { line, area, zeroY: y(0) };
}

// Short axis labels: first, middle, and last active day.
function axisLabels(series: PnlPoint[]): string[] {
  if (series.length <= 3) {
    return series.map((p) => p.date.slice(5));
  }
  const mid = series[Math.floor(series.length / 2)];
  return [
    series[0].date.slice(5),
    mid.date.slice(5),
    series[series.length - 1].date.slice(5),
  ];
}

// Cumulative ROI% over time (one point per active UTC day). Dependency-free
// inline SVG; the latest cumulative ROI is highlighted in the header.
export function BetsChart({ series }: { series: PnlPoint[] }) {
  const latest = series.at(-1)?.roiPct ?? 0;

  return (
    <Card>
      <Flex direction="column" gap="3">
        <Flex align="baseline" justify="between" gap="3">
          <Heading as="h3" size="3">
            Profit / loss % over time
          </Heading>
          {series.length > 0 && (
            <Text size="2" weight="bold" color={latest >= 0 ? "green" : "red"}>
              {latest >= 0 ? "+" : ""}
              {latest.toFixed(1)}%
            </Text>
          )}
        </Flex>

        {series.length === 0 ? (
          <Text size="2" color="gray">
            No settled bets yet — your ROI will chart here once bets settle.
          </Text>
        ) : (
          <Box>
            <svg
              viewBox={`0 0 ${VB_W} ${VB_H}`}
              width="100%"
              role="img"
              aria-label="Cumulative ROI percentage over time"
              style={{ display: "block" }}
            >
              <title>Cumulative ROI percentage over time</title>
              {(() => {
                const { line, area, zeroY } = buildPath(series);
                return (
                  <>
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
                  </>
                );
              })()}
            </svg>
            <Flex justify="between" mt="1" px="2">
              {axisLabels(series).map((label) => (
                <Text key={label} size="1" color="gray">
                  {label}
                </Text>
              ))}
            </Flex>
          </Box>
        )}
      </Flex>
    </Card>
  );
}
