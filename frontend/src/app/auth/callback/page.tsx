'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
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
    <p className="text-sm text-muted-foreground">
      {error ? `Sign-in failed: ${error}` : 'Completing sign-in…'}
    </p>
  );
}

export default function CallbackPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40">
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading…</p>}>
        <Callback />
      </Suspense>
    </div>
  );
}
