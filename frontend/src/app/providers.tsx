"use client";

import {
  ChakraProvider,
  Portal,
  Stack,
  Toast,
  Toaster,
} from "@chakra-ui/react";
import { SessionProvider } from "next-auth/react";
import { ThemeProvider } from "next-themes";
import { system } from "@/lib/theme";
import { toaster } from "@/lib/toaster";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <ThemeProvider attribute="class" defaultTheme="dark">
        <ChakraProvider value={system}>
          {children}
          <Portal>
            <Toaster toaster={toaster}>
              {(t) => (
                <Toast.Root width="2xl" p={3} gap={2}>
                  <Toast.Indicator boxSize={4} />
                  <Stack gap={1} flex="1" minW={0}>
                    <Toast.Title fontSize="sm">{t.title}</Toast.Title>
                    {t.description && (
                      <Toast.Description fontSize="xs">
                        {t.description}
                      </Toast.Description>
                    )}
                  </Stack>
                  <Toast.CloseTrigger />
                </Toast.Root>
              )}
            </Toaster>
          </Portal>
        </ChakraProvider>
      </ThemeProvider>
    </SessionProvider>
  );
}
