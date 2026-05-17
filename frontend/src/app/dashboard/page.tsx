'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Navbar } from '@/components/Navbar';
import { OddsBoard } from '@/components/OddsBoard';
import { BetSlip } from '@/components/BetSlip';
import { useOdds } from '@/hooks/useOdds';
import { useBets } from '@/hooks/useBets';
import { useBalance } from '@/hooks/useBalance';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import type { OddsEvent } from '@/types';

type Selection = { event: OddsEvent; choice: 'home' | 'away' | 'draw' } | null;

export default function DashboardPage() {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [selection, setSelection] = useState<Selection>(null);
  const odds = useOdds(token);
  const { data: bets, mutate } = useBets(token);
  const balance = useBalance(token);

  useEffect(() => {
    const t = localStorage.getItem('token');
    if (!t) { router.replace('/login'); return; }
    setToken(t);
  }, [router]);

  if (!token) return null;

  return (
    <div className="flex h-screen flex-col bg-background">
      <Navbar balance={balance} />
      <div className="flex flex-1 overflow-hidden">
        <main className="flex-1 overflow-y-auto p-6">
          <h2 className="mb-4 text-lg font-semibold text-foreground">Live Markets</h2>
          <OddsBoard
            events={odds}
            onSelect={(event, choice) => setSelection({ event, choice })}
          />

          {bets && bets.length > 0 && (
            <section className="mt-8">
              <h2 className="mb-3 text-lg font-semibold text-foreground">My Bets</h2>
              <div className="space-y-2">
                {bets.map((bet) => (
                  <Card key={bet.id}>
                    <CardContent className="py-3 flex items-center justify-between">
                      <span className="text-sm font-medium capitalize">
                        {bet.selection} @ {Number(bet.odds).toFixed(2)}
                      </span>
                      <span className="text-sm text-muted-foreground">
                        £{Number(bet.stake).toFixed(2)}
                      </span>
                      {bet.status === 'won' && (
                        <Badge variant="success" className="capitalize">{bet.status}</Badge>
                      )}
                      {bet.status === 'lost' && (
                        <Badge variant="destructive" className="capitalize">{bet.status}</Badge>
                      )}
                      {bet.status === 'pending' && (
                        <Badge variant="outline" className="capitalize">{bet.status}</Badge>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            </section>
          )}
        </main>

        <aside className="w-80 border-l bg-background p-4 overflow-y-auto">
          <BetSlip
            selection={selection}
            onPlaced={() => { setSelection(null); mutate(); }}
          />
        </aside>
      </div>
    </div>
  );
}
