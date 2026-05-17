'use client';

import { useEffect } from 'react';
import { Flex, Text } from '@chakra-ui/react';
import { startLogin } from '@/lib/keycloak';

export default function LoginPage() {
  useEffect(() => {
    startLogin().catch((err) => console.error(err));
  }, []);

  return (
    <Flex minH="100vh" align="center" justify="center" bg="bg.muted">
      <Text fontSize="sm" color="fg.muted">
        Redirecting to sign-in…
      </Text>
    </Flex>
  );
}
