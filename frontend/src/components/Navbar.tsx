'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';

export function Navbar() {
  const router = useRouter();

  function logout() {
    localStorage.removeItem('token');
    router.push('/login');
  }

  return (
    <nav className="bg-brand text-white px-6 py-3 flex items-center justify-between">
      <Link href="/dashboard" className="text-xl font-bold tracking-tight">BetApp</Link>
      <button onClick={logout} className="text-sm opacity-80 hover:opacity-100">
        Sign out
      </button>
    </nav>
  );
}
