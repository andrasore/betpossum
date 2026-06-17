"use client";

import { Flex } from "@radix-ui/themes";
import { Navbar } from "@/components/Navbar";
import { useBalance } from "@/hooks/useBalance";
import { useAuth } from "@/lib/auth-context";

// Shared shell for the authed app routes (/dashboard, /my-bets, /admin). The
// Navbar and balance live here so a single instance persists across client-side
// navigation between these routes instead of cold-mounting (and re-fetching the
// balance) on every transition.
export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { accessToken } = useAuth();
  const balance = useBalance(accessToken);

  return (
    <Flex direction="column" style={{ height: "100vh" }}>
      <Navbar balance={balance} />
      {children}
    </Flex>
  );
}
