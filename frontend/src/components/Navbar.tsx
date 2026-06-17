"use client";

import {
  Avatar,
  Badge,
  Button,
  DropdownMenu,
  Flex,
  Link,
  Separator,
  Text,
} from "@radix-ui/themes";
import {
  ChevronDown,
  LayoutDashboard,
  ListChecks,
  LogIn,
  LogOut,
  Shield,
  Wallet,
} from "lucide-react";
import NextLink from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/lib/auth-context";

interface NavbarProps {
  balance?: number | null;
}

export function Navbar({ balance }: NavbarProps) {
  const { isAuthenticated, name, roles, login, logout } = useAuth();
  const isAdmin = isAuthenticated && roles.includes("admin");
  const displayName = name ?? "";
  const initial = displayName.charAt(0).toUpperCase();
  const pathname = usePathname();
  const navItemVariant = (href: string) =>
    pathname === href ? "solid" : "ghost";
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
        <Flex align="center" flexGrow="1" flexBasis="0">
          <Link asChild underline="hover">
            <NextLink href="/dashboard">
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
            </NextLink>
          </Link>
        </Flex>
        <Flex asChild align="center" justify="center" gap="3">
          <nav aria-label="Primary">
            <Button
              asChild
              size="2"
              radius="full"
              variant={navItemVariant("/dashboard")}
              data-testid="dashboard-link"
            >
              <NextLink href="/dashboard">
                <LayoutDashboard size={16} />
                Dashboard
              </NextLink>
            </Button>
            {isAuthenticated && (
              <Button
                asChild
                size="2"
                radius="full"
                variant={navItemVariant("/my-bets")}
                data-testid="my-bets-link"
              >
                <NextLink href="/my-bets">
                  <ListChecks size={16} />
                  My Bets
                </NextLink>
              </Button>
            )}
            {isAdmin && (
              <Button
                asChild
                size="2"
                radius="full"
                variant={navItemVariant("/admin")}
                data-testid="admin-link"
              >
                <NextLink href="/admin">
                  <Shield size={16} />
                  Admin
                </NextLink>
              </Button>
            )}
          </nav>
        </Flex>
        <Flex align="center" justify="end" gap="4" flexGrow="1" flexBasis="0">
          {balance != null && (
            <Badge
              color={balance === 0 ? "yellow" : "green"}
              variant="soft"
              radius="full"
              size="2"
              data-testid="balance"
            >
              <Wallet size={18} aria-hidden />
              <Text color="gray">Balance:</Text>
              <Text size="3" weight="bold" style={{ color: "white" }}>
                £{balance.toFixed(2)}
              </Text>
            </Badge>
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
