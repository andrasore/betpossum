"use client";

import { Button, Flex, Text } from "@radix-ui/themes";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { handleCallback, login } from "@/lib/auth";

export default function AuthCallbackPage() {
  const router = useRouter();
  const [errored, setErrored] = useState(false);

  useEffect(() => {
    handleCallback()
      .then(({ returnTo, error }) => {
        if (!error) {
          router.replace(returnTo || "/");
          return;
        }
        // A failed silent refresh means Keycloak has no session; if the user
        // was actively trying to sign in, fall through to interactive login.
        // Otherwise just send them back to where they were as anonymous.
        if (error === "login_required") {
          router.replace(returnTo || "/");
        } else {
          setErrored(true);
        }
      })
      .catch(() => setErrored(true));
  }, [router]);

  return (
    <Flex align="center" justify="center" style={{ minHeight: "100vh" }}>
      {errored ? (
        <Flex direction="column" align="center" gap="3">
          <Text size="2" color="gray">
            Sign-in failed.
          </Text>
          <Button variant="ghost" size="2" onClick={() => login("/dashboard")}>
            Try again
          </Button>
        </Flex>
      ) : (
        <Text size="2" color="gray">
          Completing sign-in…
        </Text>
      )}
    </Flex>
  );
}
