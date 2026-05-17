'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Flex, Text } from '@chakra-ui/react';
import { completeLogin } from '@/lib/keycloak';

function Callback() {
  const router = useRouter();
  const params = useSearchParams();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const code = params.get('code');
    const state = params.get('state');
    if (!code || !state) {
      setError('Missing authorisation code');
      return;
    }
    completeLogin(code, state)
      .then(() => router.replace('/dashboard'))
      .catch((err) => setError(err.message ?? 'Login failed'));
  }, [params, router]);

  return (
    <Text fontSize="sm" color="fg.muted">
      {error ? `Sign-in failed: ${error}` : 'Completing sign-in…'}
    </Text>
  );
}

export default function CallbackPage() {
  return (
    <Flex minH="100vh" align="center" justify="center" bg="bg.muted">
      <Suspense fallback={<Text fontSize="sm" color="fg.muted">Loading…</Text>}>
        <Callback />
      </Suspense>
    </Flex>
  );
}
