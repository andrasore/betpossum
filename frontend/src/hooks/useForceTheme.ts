"use client";

import { useTheme } from "next-themes";
import { useEffect } from "react";

export function useForceTheme(theme: "light" | "dark"): void {
  const { setTheme } = useTheme();
  useEffect(() => {
    setTheme(theme);
  }, [theme, setTheme]);
}
