import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { CheckCircle2, XCircle, Radio } from 'lucide-react';
import StatusBadge from '@/components/arb/StatusBadge';
import { fmtUSD } from '@/lib/arbMath';

function timeAgo(ts) {
  if (!ts) return '—';
  const diff = Date.now() - new Date(ts).getTime();
  if (diff < 1000) return 'just now';
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  return `${Math.floor(diff / 3_600_000)}h ago`;
}

export default function RecentSignalsStream() {
  const { data: signals = [] } = useQuery({
    queryKey: ['arb-signals-recent-stream'],
    queryFn: async () => {
      const list = await base44.entities.ArbSignal.list('-received_time', 30);
      return list;
    },
    refetchInterval: 2000,
  });

  if (signals.length === 0) {
    return (
      <div className="text-center py-8 text-xs font-mono text-muted-foreground border border-dashed border-border rounded-lg">
        No signals ingested yet
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs font-mono">
        <thead className="text-muted-foreground border-b border-border">
          <tr>
            <th className="text-left py-2 px-2">When</th>
            <th className="text-left py-2 px-2">Pair</th>
            <th className="text-left py-2 px-2">Route</th>
            <th className="text-right py-2 px-2">Net bps</th>
            <th className="text-right py-2 px-2">Fillable</th>
            <th className="text-right py-2 px-2">PnL</th>
            <th className="text-left py-2 px-2">Status</th>
          </tr>
        </thead>
        <tbody>
          {signals.map(s => {
            const Icon = s.status === 'executed' ? CheckCircle2 : s.status === 'rejected' ? XCircle : Radio;
            const iconColor =
              s.status === 'executed' ? (s.win ? 'text-accent' : 'text-destructive') :
              s.status === 'rejected' ? 'text-muted-foreground' : 'text-primary';
            return (
              <tr key={s.id} className="border-b border-border hover:bg-secondary/30 transition-colors">
                <td className="py-2 px-2 text-muted-foreground whitespace-nowrap">
                  <div className="flex items-center gap-1.5">
                    <Icon className={`w-3 h-3 ${iconColor}`} />
                    {timeAgo(s.received_time || s.created_date)}
                  </div>
                </td>
                <td className="py-2 px-2 text-foreground font-semibold">{s.pair}</td>
                <td className="py-2 px-2 text-muted-foreground truncate max-w-[180px]">{s.buy_exchange} → {s.sell_exchange}</td>
                <td className={`py-2 px-2 text-right font-semibold ${(s.net_edge_bps || 0) > 0 ? 'text-accent' : 'text-destructive'}`}>
                  {Number(s.net_edge_bps || 0).toFixed(2)}
                </td>
                <td className="py-2 px-2 text-right text-foreground">{fmtUSD(s.fillable_size_usd || 0, 0)}</td>
                <td className={`py-2 px-2 text-right ${(s.executed_pnl_usd || 0) >= 0 ? 'text-accent' : 'text-destructive'}`}>
                  {s.executed_pnl_usd != null ? fmtUSD(s.executed_pnl_usd) : '—'}
                </td>
                <td className="py-2 px-2">
                  <StatusBadge status={
                    s.status === 'executed' ? (s.win ? 'Closed' : 'Error') :
                    s.status === 'rejected' ? 'Cancelled' :
                    s.status === 'alerted' ? 'High' : 'Monitoring'
                  } />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}