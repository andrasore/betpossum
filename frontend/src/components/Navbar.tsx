"use client";

import { Button, Flex, Text } from "@chakra-ui/react";
import { LogIn, LogOut } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";

interface NavbarProps {
  balance?: number | null;
  loggedIn?: boolean;
}

export function Navbar({ balance, loggedIn }: NavbarProps) {
  const { login, logout } = useAuth();
  return (
    <Flex
      as="nav"
      align="center"
      justify="space-between"
      px={6}
      py={3}
      borderBottomWidth="1px"
      borderColor="border"
    >
      <Link href="/dashboard">
        <Flex align="center" gap={3}>
          <Image
            src="/possum.png"
            alt=""
            width={90}
            height={48}
            priority
          />
          <Text fontSize="xl" fontWeight="bold" letterSpacing="tight">
            BetPossum
          </Text>
        </Flex>
      </Link>
      <Flex align="center" gap={4}>
        {balance != null && (
          <Text fontSize="sm" fontWeight="medium" data-testid="balance">
            Balance: £{balance.toFixed(2)}
          </Text>
        )}
        {loggedIn ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => logout()}
            data-testid="logout-button"
          >
            <LogOut size={16} />
            Sign out
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => login("/dashboard")}
            data-testid="login-button"
          >
            <LogIn size={16} />
            Sign in
          </Button>
        )}
      </Flex>
    </Flex>
  );
}
