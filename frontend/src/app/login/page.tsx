'use client';

import { useEffect } from 'react';
import { startLogin } from '@/lib/keycloak';

export default function LoginPage() {
  useEffect(() => {
    startLogin().catch((err) => console.error(err));
  }, []);

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40">
      <p className="text-sm text-muted-foreground">Redirecting to sign-in…</p>
    </div>
  );
}
