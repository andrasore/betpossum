'use client';

import type { OddsEvent } from '@/types';

interface Props {
  events: OddsEvent[];
  onSelect: (event: OddsEvent, selection: 'home' | 'away' | 'draw') => void;
}

export function OddsBoard({ events, onSelect }: Props) {
  if (events.length === 0) {
    return <p className="text-gray-500 text-sm">Waiting for live odds…</p>;
  }

  return (
    <div className="space-y-3">
      {events.map((e) => (
        <div key={e.event_id} className="rounded-lg border bg-white p-4 shadow-sm">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium uppercase text-gray-400">{e.sport}</span>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center">
            <OddsButton label={e.home_team} odds={e.home_odds} onClick={() => onSelect(e, 'home')} />
            {e.draw_odds > 0 && (
              <OddsButton label="Draw" odds={e.draw_odds} onClick={() => onSelect(e, 'draw')} />
            )}
            <OddsButton label={e.away_team} odds={e.away_odds} onClick={() => onSelect(e, 'away')} />
          </div>
        </div>
      ))}
    </div>
  );
}

function OddsButton({ label, odds, onClick }: { label: string; odds: number; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="rounded border border-brand px-3 py-2 text-sm font-semibold text-brand hover:bg-brand hover:text-white transition-colors"
    >
      <div className="truncate">{label}</div>
      <div className="text-lg font-bold">{odds.toFixed(2)}</div>
    </button>
  );
}
