"use client";

import { Flex, Text } from "@radix-ui/themes";
import { Dice5 } from "lucide-react";

// Persistent disclaimer for the public demo deployment: balances are seeded
// play money and no real funds are involved. Mounted once in the app shell
// above the Navbar, so it shows on every route a visitor sees.
export function DemoBanner() {
  return (
    <Flex
      align="center"
      justify="center"
      gap="2"
      px="6"
      py="1"
      data-testid="demo-banner"
      style={{
        background: "var(--amber-a3)",
        color: "var(--amber-11)",
        borderBottom: "1px solid var(--gray-a5)",
      }}
    >
      <Dice5 size={16} aria-hidden />
      <Text size="2" weight="medium">
        Demo — play money only. No real funds are involved.
      </Text>
    </Flex>
  );
}
