'use client';

import { useState } from 'react';
import type { OddsEvent } from '@/types';
import { placeBet } from '@/lib/api';

interface Selection {
  event: OddsEvent;
  choice: 'home' | 'away' | 'draw';
}

interface Props {
  selection: Selection | null;
  token: string;
  onPlaced: () => void;
}

export function BetSlip({ selection, token, onPlaced }: Props) {
  const [stake, setStake] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!selection) {
    return (
      <div className="rounded-lg border bg-gray-50 p-4 text-sm text-gray-400">
        Click any odds to build your bet slip.
      </div>
    );
  }

  const { event, choice } = selection;
  const odds = choice === 'home' ? event.homeOdds : choice === 'away' ? event.awayOdds : event.drawOdds;
  const potentialReturn = stake ? (parseFloat(stake) * odds).toFixed(2) : '—';

  async function submit() {
    if (!stake || isNaN(Number(stake))) return;
    setLoading(true);
    setError(null);
    try {
      await placeBet(token, {
        eventId: event.eventId,
        selection: choice,
        odds,
        stake: parseFloat(stake),
      });
      setStake('');
      onPlaced();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-lg border bg-white p-4 shadow-sm space-y-3">
      <h2 className="font-semibold text-gray-800">Bet Slip</h2>
      <div className="text-sm">
        <p className="font-medium">{event.homeTeam} vs {event.awayTeam}</p>
        <p className="text-gray-500 capitalize">{choice} @ {odds.toFixed(2)}</p>
      </div>
      <input
        type="number"
        min="0.01"
        step="0.01"
        placeholder="Stake (£)"
        value={stake}
        onChange={(e) => setStake(e.target.value)}
        className="w-full rounded border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand"
      />
      <div className="flex justify-between text-sm text-gray-500">
        <span>Potential return</span>
        <span className="font-semibold text-gray-800">£{potentialReturn}</span>
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
      <button
        onClick={submit}
        disabled={loading || !stake}
        className="w-full rounded bg-brand py-2 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-50"
      >
        {loading ? 'Placing…' : 'Place Bet'}
      </button>
    </div>
  );
}
