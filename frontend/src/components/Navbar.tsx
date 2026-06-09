"use client";

import { Button, Flex, Text } from "@radix-ui/themes";
import { ListChecks, LogIn, LogOut, Shield } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";

interface NavbarProps {
  balance?: number | null;
}

export function Navbar({ balance }: NavbarProps) {
  const { isAuthenticated, roles, login, logout } = useAuth();
  const isAdmin = isAuthenticated && roles.includes("admin");
  return (
    <Flex
      asChild
      align="center"
      justify="between"
      px="6"
      py="3"
      style={{ borderBottom: "1px solid var(--gray-a5)" }}
    >
      <nav>
        <Link href="/dashboard">
          <Flex align="center" gap="3">
            <Image src="/possum.png" alt="" width={90} height={48} priority />
            <Text
              size="7"
              weight="bold"
              style={{
                fontFamily: "var(--font-display), system-ui, sans-serif",
                letterSpacing: "-0.02em",
              }}
            >
              BetPossum
            </Text>
          </Flex>
        </Link>
        <Flex align="center" gap="4">
          {balance != null && (
            <Text size="2" weight="medium" data-testid="balance">
              Balance: £{balance.toFixed(2)}
            </Text>
          )}
          {isAuthenticated && (
            <Button asChild variant="ghost" size="2" data-testid="my-bets-link">
              <Link href="/my-bets">
                <ListChecks size={16} />
                My Bets
              </Link>
            </Button>
          )}
          {isAdmin && (
            <Button asChild variant="ghost" size="2" data-testid="admin-link">
              <Link href="/admin">
                <Shield size={16} />
                Admin
              </Link>
            </Button>
          )}
          {isAuthenticated ? (
            <Button
              variant="ghost"
              size="2"
              onClick={() => logout()}
              data-testid="logout-button"
            >
              <LogOut size={16} />
              Sign out
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="2"
              onClick={() => login("/dashboard")}
              data-testid="login-button"
            >
              <LogIn size={16} />
              Sign in
            </Button>
          )}
        </Flex>
      </nav>
    </Flex>
  );
}
