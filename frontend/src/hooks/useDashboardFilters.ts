"use client";

import { useState } from "react";
import type { League } from "@/generated/events";

export type DashboardFilters = {
  // The selected sport slug (what GET /odds filters on), or null for "All".
  selectedSport: string | null;
  // The selected league id, or null for "All".
  selectedLeague: number | null;
  selectSport: (slug: string | null) => void;
  selectLeague: (league: League | null) => void;
};

// The dashboard's sport/league filter state machine. The two bars must stay
// consistent because a league belongs to exactly one sport:
//   - Changing the sport clears the league (the prior league belongs to a
//     different sport, so it can't stay selected).
//   - Picking a league auto-selects its parent sport, so the sport bar lights
//     up the matching chip and the league bar re-scopes to that sport.
// Kept out of the page component so the coordination can be tested directly.
export function useDashboardFilters(): DashboardFilters {
  const [selectedSport, setSelectedSport] = useState<string | null>(null);
  const [selectedLeague, setSelectedLeague] = useState<number | null>(null);

  return {
    selectedSport,
    selectedLeague,
    selectSport: (slug) => {
      setSelectedSport(slug);
      setSelectedLeague(null);
    },
    selectLeague: (league) => {
      if (league === null) {
        setSelectedLeague(null);
        return;
      }
      setSelectedLeague(league.id);
      setSelectedSport(league.sportSlug);
    },
  };
}
