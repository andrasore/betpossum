'use client';

import Link from 'next/link';
import { LogOut } from 'lucide-react';
import { Button, Flex, Text } from '@chakra-ui/react';
import { logout } from '@/lib/keycloak';

interface NavbarProps {
  balance?: number | null;
}

export function Navbar({ balance }: NavbarProps) {
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
        <Text fontSize="xl" fontWeight="bold" letterSpacing="tight">
          BetPossum
        </Text>
      </Link>
      <Flex align="center" gap={4}>
        {balance != null && (
          <Text fontSize="sm" fontWeight="medium">
            Balance: £{balance.toFixed(2)}
          </Text>
        )}
        <Button variant="ghost" size="sm" onClick={logout}>
          <LogOut size={16} />
          Sign out
        </Button>
      </Flex>
    </Flex>
  );
}
