"use client";

import { Button, Flex } from "@radix-ui/themes";
import type { Sport } from "@/lib/schemas";

type SportFilterBarProps = {
  sports: Sport[];
  // The selected sport slug, or null for "All".
  selected: string | null;
  onSelect: (slug: string | null) => void;
};

// Single-select chips that filter the dashboard by canonical sport. The "All"
// chip clears the filter; selecting a chip emits its sport slug (what GET /odds
// filters on), while the chip label is the sport's display name.
export function SportFilterBar({
  sports,
  selected,
  onSelect,
}: SportFilterBarProps) {
  if (sports.length === 0) {
    return null;
  }

  return (
    <Flex gap="2" wrap="wrap" mb="4" data-testid="sport-filter-bar">
      <Chip
        label="All"
        active={selected === null}
        onClick={() => onSelect(null)}
        testId="sport-chip-all"
      />
      {sports.map((sport) => (
        <Chip
          key={sport.slug}
          label={sport.name}
          active={selected === sport.slug}
          onClick={() => onSelect(sport.slug)}
          testId={`sport-chip-${sport.slug}`}
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
