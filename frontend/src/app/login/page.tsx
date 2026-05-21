"use client";

import { Flex, Text } from "@chakra-ui/react";
import { useEffect } from "react";
import { useForceTheme } from "@/hooks/useForceTheme";
import { startLogin } from "@/lib/keycloak";

export default function LoginPage() {
  useForceTheme("dark");
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
