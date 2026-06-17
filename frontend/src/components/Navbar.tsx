"use client";

import {
  Avatar,
  Badge,
  Button,
  DropdownMenu,
  Flex,
  Link,
  Text,
} from "@radix-ui/themes";
import {
  ChevronDown,
  ListChecks,
  LogIn,
  LogOut,
  Shield,
  Wallet,
} from "lucide-react";
import { useAuth } from "@/lib/auth-context";

interface NavbarProps {
  balance?: number | null;
}

export function Navbar({ balance }: NavbarProps) {
  const { isAuthenticated, name, roles, login, logout } = useAuth();
  const isAdmin = isAuthenticated && roles.includes("admin");
  const displayName = name ?? "";
  const initial = displayName.charAt(0).toUpperCase();
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
        <Link href="/dashboard" underline="hover">
          <Flex align="center" gap="3">
            <span
              aria-hidden
              style={{
                display: "block",
                width: 90,
                height: 48,
                backgroundColor: "var(--accent-11)",
                WebkitMaskImage: "url(/possum.png)",
                maskImage: "url(/possum.png)",
                WebkitMaskRepeat: "no-repeat",
                maskRepeat: "no-repeat",
                WebkitMaskSize: "contain",
                maskSize: "contain",
                WebkitMaskPosition: "center",
                maskPosition: "center",
              }}
            />
            <Text
              size="7"
              weight="bold"
              style={{
                fontFamily: "var(--font-display), system-ui, sans-serif",
                letterSpacing: "-0.02em",
                color: "var(--accent-11)",
              }}
            >
              BetPossum
            </Text>
          </Flex>
        </Link>
        <Flex align="center" gap="4">
          {balance != null && (
            <Badge
              color={balance === 0 ? "yellow" : "green"}
              variant="soft"
              radius="full"
              size="2"
              data-testid="balance"
            >
              <Wallet size={14} aria-hidden />
              Balance: £{balance.toFixed(2)}
            </Badge>
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
            <DropdownMenu.Root>
              <DropdownMenu.Trigger>
                <button
                  type="button"
                  data-testid="account-menu"
                  aria-label="Account menu"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "var(--space-2)",
                    padding: "var(--space-1) var(--space-2)",
                    borderRadius: "var(--radius-3)",
                    background: "transparent",
                    border: "none",
                    cursor: "pointer",
                    color: "inherit",
                  }}
                >
                  <Flex direction="column" align="end" gap="0">
                    <Text size="1" color="gray">
                      Welcome back
                    </Text>
                    <Text size="2" weight="medium" data-testid="account-name">
                      {displayName}
                    </Text>
                  </Flex>
                  <Avatar
                    size="2"
                    radius="full"
                    fallback={initial}
                    variant="solid"
                  />
                  <ChevronDown size={16} aria-hidden />
                </button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Content align="end">
                <DropdownMenu.Item
                  color="red"
                  onSelect={() => logout()}
                  data-testid="logout-button"
                >
                  <LogOut size={16} />
                  Sign out
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Root>
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
