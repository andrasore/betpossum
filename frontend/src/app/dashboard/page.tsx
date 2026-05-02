'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Navbar } from '@/components/Navbar';
import { OddsBoard } from '@/components/OddsBoard';
import { BetSlip } from '@/components/BetSlip';
import { useOdds } from '@/hooks/useOdds';
import { useBets } from '@/hooks/useBets';
import type { OddsEvent } from '@/types';

type Selection = { event: OddsEvent; choice: 'home' | 'away' | 'draw' } | null;

export default function DashboardPage() {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [selection, setSelection] = useState<Selection>(null);
  const odds = useOdds(token);
  const { data: bets, mutate } = useBets(token);

  useEffect(() => {
    const t = localStorage.getItem('token');
    if (!t) { router.replace('/login'); return; }
    setToken(t);
  }, [router]);

  if (!token) return null;

  return (
    <div className="flex h-screen flex-col">
      <Navbar />
      <div className="flex flex-1 overflow-hidden">
        <main className="flex-1 overflow-y-auto p-6">
          <h2 className="mb-4 text-lg font-semibold text-gray-800">Live Markets</h2>
          <OddsBoard
            events={odds}
            onSelect={(event, choice) => setSelection({ event, choice })}
          />

          {bets && bets.length > 0 && (
            <section className="mt-8">
              <h2 className="mb-3 text-lg font-semibold text-gray-800">My Bets</h2>
              <div className="space-y-2">
                {bets.map((bet) => (
                  <div key={bet.id} className="rounded border bg-white p-3 text-sm flex justify-between items-center">
                    <span className="font-medium capitalize">{bet.selection} @ {Number(bet.odds).toFixed(2)}</span>
                    <span className="text-gray-500">£{Number(bet.stake).toFixed(2)}</span>
                    <span className={`capitalize font-semibold ${
                      bet.status === 'won' ? 'text-green-600' :
                      bet.status === 'lost' ? 'text-red-600' : 'text-gray-500'
                    }`}>{bet.status}</span>
                  </div>
                ))}
              </div>
            </section>
          )}
        </main>

        <aside className="w-80 border-l bg-white p-4 overflow-y-auto">
          <BetSlip selection={selection} token={token} onPlaced={() => { setSelection(null); mutate(); }} />
        </aside>
      </div>
    </div>
  );
}
