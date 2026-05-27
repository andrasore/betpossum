"use client";

import { Flex, Text } from "@chakra-ui/react";
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
    <Flex minH="100vh" align="center" justify="center" bg="bg.muted">
      {errored ? (
        <Flex direction="column" align="center" gap={3}>
          <Text fontSize="sm" color="fg.muted">
            Sign-in failed.
          </Text>
          <Text
            as="button"
            fontSize="sm"
            textDecoration="underline"
            onClick={() => login("/dashboard")}
          >
            Try again
          </Text>
        </Flex>
      ) : (
        <Text fontSize="sm" color="fg.muted">
          Completing sign-in…
        </Text>
      )}
    </Flex>
  );
}
