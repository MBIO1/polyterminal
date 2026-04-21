import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Wifi, WifiOff } from 'lucide-react';
import Section from '@/components/arb/Section';

const VENUES = ['OKX-spot', 'OKX-perp', 'Bybit-spot', 'Bybit-perp'];

// A venue is "live" if we've seen its name in any signal's buy/sell_exchange
// within the last 90 seconds.
function getVenueFreshness(signals) {
  const now = Date.now();
  const lastSeen = {};
  for (const s of signals) {
    const ts = new Date(s.received_time || s.created_date).getTime();
    if (s.buy_exchange) lastSeen[s.buy_exchange] = Math.max(lastSeen[s.buy_exchange] || 0, ts);
    if (s.sell_exchange) lastSeen[s.sell_exchange] = Math.max(lastSeen[s.sell_exchange] || 0, ts);
  }
  return VENUES.map(v => {
    const last = lastSeen[v];
    const ageSec = last ? Math.round((now - last) / 1000) : null;
    const isLive = ageSec !== null && ageSec < 90;
    return { venue: v, ageSec, isLive };
  });
}

export default function VenueConnectivityPanel() {
  const { data: signals = [] } = useQuery({
    queryKey: ['bot-venue-connectivity'],
    queryFn: () => base44.entities.ArbSignal.list('-received_time', 200),
    refetchInterval: 5000,
  });

  const rows = getVenueFreshness(signals);
  const liveCount = rows.filter(r => r.isLive).length;

  return (
    <Section
      title="Venue Connectivity"
      subtitle={`${liveCount}/4 feeds live · based on recent signal ingestion`}
    >
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {rows.map(({ venue, ageSec, isLive }) => (
          <div
            key={venue}
            className={`rounded-lg border p-4 ${
              isLive ? 'border-accent/40 bg-accent/5' : 'border-destructive/40 bg-destructive/5'
            }`}
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-mono font-semibold text-foreground">{venue}</span>
              {isLive ? (
                <Wifi className="w-4 h-4 text-accent" />
              ) : (
                <WifiOff className="w-4 h-4 text-destructive" />
              )}
            </div>
            <div className={`text-lg font-bold ${isLive ? 'text-accent' : 'text-destructive'}`}>
              {isLive ? 'LIVE' : 'STALE'}
            </div>
            <div className="text-[10px] font-mono text-muted-foreground mt-1">
              {ageSec === null ? 'no data' : `last seen ${ageSec}s ago`}
            </div>
          </div>
        ))}
      </div>
      <p className="text-[10px] font-mono text-muted-foreground mt-3">
        A venue is considered LIVE if it appears in any ingested signal within the last 90s.
        Venues the bot watches but that never reach the edge threshold may still appear STALE here.
      </p>
    </Section>
  );
}