'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface NavbarProps {
  balance?: number | null;
}

export function Navbar({ balance }: NavbarProps) {
  const router = useRouter();

  function logout() {
    localStorage.removeItem('token');
    router.push('/login');
  }

  return (
    <nav className="border-b bg-background px-6 py-3 flex items-center justify-between">
      <Link href="/dashboard" className="text-xl font-bold tracking-tight text-foreground">
        BetPossum
      </Link>
      <div className="flex items-center gap-4">
        {balance != null && (
          <span className="text-sm font-medium text-foreground">
            Balance: £{balance.toFixed(2)}
          </span>
        )}
        <Button variant="ghost" size="sm" onClick={logout} className="gap-2">
          <LogOut className="h-4 w-4" />
          Sign out
        </Button>
      </div>
    </nav>
  );
}
