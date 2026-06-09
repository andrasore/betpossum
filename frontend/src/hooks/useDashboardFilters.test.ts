import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { League } from "@/lib/schemas";
import { useDashboardFilters } from "./useDashboardFilters";

const nbaLeague: League = { id: 7, name: "NBA", sportSlug: "basketball" };

describe("useDashboardFilters", () => {
  it("starts with no sport or league selected", () => {
    const { result } = renderHook(() => useDashboardFilters());
    expect(result.current.selectedSport).toBeNull();
    expect(result.current.selectedLeague).toBeNull();
  });

  it("picking a league auto-selects its parent sport", () => {
    const { result } = renderHook(() => useDashboardFilters());
    act(() => result.current.selectLeague(nbaLeague));
    expect(result.current.selectedLeague).toBe(7);
    expect(result.current.selectedSport).toBe("basketball");
  });

  it("changing the sport resets the league to All", () => {
    const { result } = renderHook(() => useDashboardFilters());
    act(() => result.current.selectLeague(nbaLeague));
    act(() => result.current.selectSport("soccer"));
    expect(result.current.selectedSport).toBe("soccer");
    expect(result.current.selectedLeague).toBeNull();
  });

  it("clearing the league (All) keeps the current sport", () => {
    const { result } = renderHook(() => useDashboardFilters());
    act(() => result.current.selectLeague(nbaLeague));
    act(() => result.current.selectLeague(null));
    expect(result.current.selectedLeague).toBeNull();
    expect(result.current.selectedSport).toBe("basketball");
  });
});
