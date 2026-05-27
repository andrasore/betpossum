"use client";

import { Flex, Text } from "@chakra-ui/react";
import { useEffect } from "react";
import { useForceTheme } from "@/hooks/useForceTheme";
import { login } from "@/lib/auth";

export default function LoginPage() {
  useForceTheme("dark");
  useEffect(() => {
    login("/dashboard");
  }, []);

  return (
    <Flex minH="100vh" align="center" justify="center" bg="bg.muted">
      <Text fontSize="sm" color="fg.muted">
        Redirecting to sign-in…
      </Text>
    </Flex>
  );
}
