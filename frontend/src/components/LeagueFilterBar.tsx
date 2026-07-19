"use client";

import { Button, Flex } from "@radix-ui/themes";
import type { League } from "@/generated/events";
import { type AccentColor, sportColor } from "@/lib/sportColor";

type LeagueFilterBarProps = {
  leagues: League[];
  // The selected league id, or null for "All".
  selected: number | null;
  onSelect: (league: League | null) => void;
};

// Single-select chips that filter the dashboard by canonical league, sitting
// under the sport bar. The "All" chip clears the filter; selecting a chip emits
// the whole league (what GET /odds/events filters on is its id) so the dashboard can
// also auto-select the league's parent sport. The chip label is the league name.
export function LeagueFilterBar({
  leagues,
  selected,
  onSelect,
}: LeagueFilterBarProps) {
  // Keep the bar mounted with a fixed minimum height even when there are no
  // leagues yet (e.g. while the scoped list reloads after a sport switch), so
  // the odds grid below doesn't jump up as the chips appear and disappear. The
  // min-height matches a single size-1 chip row.
  return (
    <Flex
      gap="2"
      wrap="wrap"
      mb="4"
      data-testid="league-filter-bar"
      style={{ minHeight: "var(--space-5)" }}
    >
      {leagues.length > 0 && (
        <>
          <Chip
            label="All"
            active={selected === null}
            onClick={() => onSelect(null)}
            testId="league-chip-all"
          />
          {leagues.map((league) => (
            <Chip
              key={league.id}
              label={league.name}
              active={selected === league.id}
              onClick={() => onSelect(league)}
              color={sportColor(league.sportSlug)}
              testId={`league-chip-${league.id}`}
            />
          ))}
        </>
      )}
    </Flex>
  );
}

type ChipProps = {
  label: string;
  active: boolean;
  onClick: () => void;
  // The parent sport's stable color, tinted when inactive and filled when
  // active. Omitted for the neutral "All" chip, which falls back to gray.
  color?: AccentColor;
  testId: string;
};

function Chip({ label, active, onClick, color, testId }: ChipProps) {
  return (
    <Button
      type="button"
      size="1"
      radius="full"
      variant={active ? "solid" : "soft"}
      color={color ?? "gray"}
      onClick={onClick}
      aria-pressed={active}
      data-testid={testId}
    >
      {label}
    </Button>
  );
}
