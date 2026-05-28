"use client";

import { Flex, Text } from "@radix-ui/themes";
import { useEffect } from "react";
import { login } from "@/lib/auth";

export default function LoginPage() {
  useEffect(() => {
    login("/dashboard");
  }, []);

  return (
    <Flex align="center" justify="center" style={{ minHeight: "100vh" }}>
      <Text size="2" color="gray">
        Redirecting to sign-in…
      </Text>
    </Flex>
  );
}
