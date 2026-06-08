"use client";

import { Button, Flex } from "@radix-ui/themes";
import type { League } from "@/lib/schemas";

type LeagueFilterBarProps = {
  leagues: League[];
  // The selected league id, or null for "All".
  selected: number | null;
  onSelect: (league: League | null) => void;
};

// Single-select chips that filter the dashboard by canonical league, sitting
// under the sport bar. The "All" chip clears the filter; selecting a chip emits
// the whole league (what GET /odds filters on is its id) so the dashboard can
// also auto-select the league's parent sport. The chip label is the league name.
export function LeagueFilterBar({
  leagues,
  selected,
  onSelect,
}: LeagueFilterBarProps) {
  if (leagues.length === 0) {
    return null;
  }

  return (
    <Flex gap="2" wrap="wrap" mb="4" data-testid="league-filter-bar">
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
          testId={`league-chip-${league.id}`}
        />
      ))}
    </Flex>
  );
}

type ChipProps = {
  label: string;
  active: boolean;
  onClick: () => void;
  testId: string;
};

function Chip({ label, active, onClick, testId }: ChipProps) {
  return (
    <Button
      type="button"
      size="1"
      radius="full"
      variant={active ? "solid" : "soft"}
      color={active ? undefined : "gray"}
      onClick={onClick}
      aria-pressed={active}
      data-testid={testId}
    >
      {label}
    </Button>
  );
}
