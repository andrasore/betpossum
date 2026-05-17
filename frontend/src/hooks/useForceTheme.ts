'use client';

import { useEffect } from 'react';
import { useTheme } from 'next-themes';

export function useForceTheme(theme: 'light' | 'dark'): void {
  const { setTheme } = useTheme();
  useEffect(() => {
    setTheme(theme);
  }, [theme, setTheme]);
}
