"use client";

import { useEffect, useState } from "react";
import type { League } from "@/generated/events";

const SHOW_CONCLUDED = "odds:show-concluded";

export type DashboardFilters = {
  // The selected sport slug (what GET /odds/events filters on), or null for "All".
  selectedSport: string | null;
  // The selected league id, or null for "All".
  selectedLeague: number | null;
  // Whether resolved events stay on the board. GET /odds/events always returns
  // them, so this is a client-side filter.
  showConcluded: boolean;
  selectSport: (slug: string | null) => void;
  selectLeague: (league: League | null) => void;
  setShowConcluded: (show: boolean) => void;
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
  // Starts false and is rehydrated on mount rather than seeded from
  // localStorage in the initializer: the app is a static export, so the
  // prerendered HTML is always built with false and a storage-seeded first
  // render would be a hydration mismatch.
  const [showConcluded, setShowConcluded] = useState(false);

  useEffect(() => {
    if (localStorage.getItem(SHOW_CONCLUDED) === "1") {
      setShowConcluded(true);
    }
  }, []);

  return {
    selectedSport,
    selectedLeague,
    showConcluded,
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
    setShowConcluded: (show) => {
      setShowConcluded(show);
      if (show) {
        localStorage.setItem(SHOW_CONCLUDED, "1");
      } else {
        localStorage.removeItem(SHOW_CONCLUDED);
      }
    },
  };
}
