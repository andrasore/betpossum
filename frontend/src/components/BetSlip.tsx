'use client';

import { useState } from 'react';
import type { OddsEvent } from '@/types';
import { placeBet } from '@/lib/api';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';

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
      <Card className="bg-muted/40 border-dashed">
        <CardContent className="pt-6 text-sm text-muted-foreground text-center">
          Click any odds to build your bet slip.
        </CardContent>
      </Card>
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
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Bet Slip</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-0.5">
          <p className="text-sm font-medium">{event.homeTeam} vs {event.awayTeam}</p>
          <p className="text-xs text-muted-foreground capitalize">{choice} @ {odds.toFixed(2)}</p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="stake">Stake (£)</Label>
          <div className="relative flex">
            <Input
              id="stake"
              type="number"
              min="0.01"
              step="0.01"
              placeholder="0.00"
              value={stake}
              onChange={(e) => setStake(e.target.value)}
              className="pr-6 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
            />
            <div className="absolute right-0 inset-y-0 flex flex-col border-l border-input">
              <button
                type="button"
                tabIndex={-1}
                onClick={() => setStake(v => (Math.max(0, (parseFloat(v) || 0) + 1)).toFixed(2))}
                className="flex flex-1 items-center justify-center px-1 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors rounded-tr-md"
              >
                <ChevronUp className="size-3" />
              </button>
              <button
                type="button"
                tabIndex={-1}
                onClick={() => setStake(v => (Math.max(0, (parseFloat(v) || 0) - 1)).toFixed(2))}
                className="flex flex-1 items-center justify-center px-1 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors rounded-br-md border-t border-input"
              >
                <ChevronDown className="size-3" />
              </button>
            </div>
          </div>
        </div>
        <Separator />
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">Potential return</span>
          <span className="font-semibold">£{potentialReturn}</span>
        </div>
        {error && <p className="text-xs text-destructive">{error}</p>}
      </CardContent>
      <CardFooter>
        <Button className="w-full" onClick={submit} disabled={loading || !stake}>
          {loading ? 'Placing…' : 'Place Bet'}
        </Button>
      </CardFooter>
    </Card>
  );
}
