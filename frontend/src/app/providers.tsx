"use client";

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { SessionProvider } from "next-auth/react";
import { ThemeProvider } from "next-themes";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <ThemeProvider attribute="class" defaultTheme="dark">
        <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
      </ThemeProvider>
    </SessionProvider>
  );
}
