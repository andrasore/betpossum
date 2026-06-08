import type { Badge } from "@radix-ui/themes";
import type { ComponentProps } from "react";

// Radix doesn't export its accent-color union from the package root, so derive
// it from a component's `color` prop — the exact set Radix accepts.
export type AccentColor = NonNullable<ComponentProps<typeof Badge>["color"]>;

// Curated Radix accent colors for sport chips/badges, chosen to be visually
// distinct on the forced-dark theme. `gray` is intentionally excluded — it is
// reserved for the neutral "All" chip and league badges.
const PALETTE: AccentColor[] = [
  "tomato",
  "crimson",
  "pink",
  "purple",
  "violet",
  "indigo",
  "blue",
  "cyan",
  "teal",
  "jade",
  "grass",
  "orange",
  "amber",
  "yellow",
  "bronze",
  "sky",
];

// 32-bit FNV-1a hash (unsigned). Deterministic and dependency-free, so a slug
// always maps to the same palette index regardless of how the sports list is
// ordered or how many sports exist.
function hashSlug(slug: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < slug.length; i++) {
    h ^= slug.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// Stable color for a sport slug. Collisions (two sports landing on the same
// hue) are acceptable given the small palette vs. the handful of sports, so no
// de-duplication is attempted.
export function sportColor(slug: string): AccentColor {
  return PALETTE[hashSlug(slug) % PALETTE.length];
}
