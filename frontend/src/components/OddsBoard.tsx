'use client';

import type { OddsEvent } from '@/types';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

interface Props {
  events: OddsEvent[];
  onSelect: (event: OddsEvent, selection: 'home' | 'away' | 'draw') => void;
}

export function OddsBoard({ events, onSelect }: Props) {
  if (events.length === 0) {
    return (
      <Card className="bg-muted/40 border-dashed">
        <CardContent className="pt-6 text-sm text-muted-foreground text-center">
          Waiting for live odds…
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {events.map((e) => (
        <Card key={e.eventId}>
          <CardContent className="pt-4">
            <div className="mb-3">
              <Badge variant="secondary" className="uppercase text-xs tracking-wide">
                {e.sport}
              </Badge>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <OddsButton label={e.homeTeam} odds={e.homeOdds} onClick={() => onSelect(e, 'home')} />
              {e.drawOdds > 0 ? (
                <OddsButton label="Draw" odds={e.drawOdds} onClick={() => onSelect(e, 'draw')} />
              ) : (
                <div />
              )}
              <OddsButton label={e.awayTeam} odds={e.awayOdds} onClick={() => onSelect(e, 'away')} />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function OddsButton({ label, odds, onClick }: { label: string; odds: number; onClick: () => void }) {
  return (
    <Button
      variant="outline"
      onClick={onClick}
      className="h-auto flex-col gap-0.5 py-2 px-3"
    >
      <span className="text-xs font-medium truncate max-w-full">{label}</span>
      <span className="text-base font-bold">{odds.toFixed(2)}</span>
    </Button>
  );
}
