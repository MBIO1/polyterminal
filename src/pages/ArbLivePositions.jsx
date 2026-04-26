import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';
import { Plus, Trash2, X, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import Section from '@/components/arb/Section';
import EmptyState from '@/components/arb/EmptyState';
import StatusBadge from '@/components/arb/StatusBadge';
import { ASSETS, EXCHANGES, POSITION_STATUS, fmtUSD } from '@/lib/arbMath';

const init = (p) => ({
  snapshot_time: p?.snapshot_time ? p.snapshot_time.slice(0, 16) : new Date().toISOString().slice(0, 16),
  asset: p?.asset || 'BTC',
  spot_exchange: p?.spot_exchange || '',
  perp_exchange: p?.perp_exchange || '',
  spot_qty: p?.spot_qty ?? '',
  perp_qty: p?.perp_qty ?? '',
  spot_mark: p?.spot_mark ?? '',
  perp_mark: p?.perp_mark ?? '',
  spot_notional: p?.spot_notional ?? '',
  perp_notional: p?.perp_notional ?? '',
  net_delta_usd: p?.net_delta_usd ?? '',
  collateral_balance: p?.collateral_balance ?? '',
  margin_used: p?.margin_used ?? '',
  margin_utilization_pct: p?.margin_utilization_pct ?? '',
  liq_distance_pct: p?.liq_distance_pct ?? '',
  funding_next: p?.funding_next ?? '',
  status: p?.status || 'Open',
  linked_trade_id: p?.linked_trade_id || '',
  notes: p?.notes || '',
});

export default function ArbLivePositions() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [f, setF] = useState(init());

  const { data: positions = [], isLoading } = useQuery({
    queryKey: ['arb-positions-all'],
    queryFn: () => base44.asServiceRole.entities.ArbLivePosition.list('-snapshot_time', 500),
    staleTime: 3_000,
    refetchInterval: 10_000,
  });

  const persist = useMutation({
    mutationFn: async ({ id, data }) => {
      const clean = { ...data };
      ['spot_qty', 'perp_qty', 'spot_mark', 'perp_mark', 'spot_notional', 'perp_notional',
        'net_delta_usd', 'collateral_balance', 'margin_used', 'margin_utilization_pct',
        'liq_distance_pct', 'funding_next'].forEach(k => {
          if (clean[k] === '' || clean[k] == null) clean[k] = null;
          else clean[k] = Number(clean[k]);
        });
      // auto-compute notionals if missing
      if (clean.spot_notional == null && clean.spot_qty != null && clean.spot_mark != null) clean.spot_notional = clean.spot_qty * clean.spot_mark;
      if (clean.perp_notional == null && clean.perp_qty != null && clean.perp_mark != null) clean.perp_notional = clean.perp_qty * clean.perp_mark;
      if (clean.net_delta_usd == null) clean.net_delta_usd = (clean.spot_notional || 0) + (clean.perp_notional || 0);
      return id ? base44.entities.ArbLivePosition.update(id, clean) : base44.entities.ArbLivePosition.create(clean);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['arb-positions-all'] }); qc.invalidateQueries({ queryKey: ['arb-positions'] }); toast.success('Saved'); setShowForm(false); setEditing(null); },
    onError: (e) => toast.error(e.message),
  });
  const del = useMutation({
    mutationFn: (id) => base44.entities.ArbLivePosition.delete(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['arb-positions-all'] }); toast.success('Deleted'); },
  });

  const openForm = (p = null) => { setEditing(p); setF(init(p)); setShowForm(true); };
  const set = (k, v) => setF(prev => ({ ...prev, [k]: v }));

  const getAgeCategory = (snapshotTime) => {
    if (!snapshotTime) return { age: '0s', color: 'bg-green-500', label: 'Fresh (<30s)' };
    const ageMs = Date.now() - new Date(snapshotTime).getTime();
    const ageSec = Math.floor(ageMs / 1000);
    const ageMin = Math.floor(ageMs / 60000);
    if (ageSec < 30) return { age: `${ageSec}s`, color: 'bg-green-500', label: 'Fresh (<30s)' };
    if (ageMin < 5) return { age: `${ageMin}m`, color: 'bg-blue-500', label: 'Recent (30s-5m)' };
    if (ageMin < 15) return { age: `${ageMin}m`, color: 'bg-yellow-500', label: 'Stale (5-15m)' };
    return { age: `${ageMin}m`, color: 'bg-red-500', label: 'Very stale (15m+)' };
  };

  const numField = (k, label, step = 'any') => (
    <div>
      <Label className="text-xs font-mono text-muted-foreground">{label}</Label>
      <Input type="number" step={step} value={f[k] ?? ''} onChange={(e) => set(k, e.target.value)} className="font-mono mt-1" />
    </div>
  );

  return (
    <div className="p-4 md:p-6 lg:p-8 max-w-[1700px] mx-auto space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Live Positions</h1>
          <p className="text-sm text-muted-foreground mt-1 font-mono">{positions.length} snapshots</p>
        </div>
        <Button onClick={() => openForm()}><Plus className="w-4 h-4 mr-2" /> New Snapshot</Button>
      </div>

      {showForm && (
        <Section
          title={editing ? 'Edit Snapshot' : 'New Snapshot'}
          action={<Button variant="ghost" size="icon" onClick={() => { setShowForm(false); setEditing(null); }}><X className="w-4 h-4" /></Button>}
        >
          <form onSubmit={(e) => { e.preventDefault(); persist.mutate({ id: editing?.id, data: f }); }} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-3">
              <div>
                <Label className="text-xs font-mono text-muted-foreground">Snapshot Time</Label>
                <Input type="datetime-local" value={f.snapshot_time} onChange={(e) => set('snapshot_time', e.target.value)} className="font-mono mt-1" />
              </div>
              <div>
                <Label className="text-xs font-mono text-muted-foreground">Asset</Label>
                <Select value={f.asset} onValueChange={(v) => set('asset', v)}>
                  <SelectTrigger className="font-mono mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>{ASSETS.map(a => <SelectItem key={a} value={a}>{a}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs font-mono text-muted-foreground">Status</Label>
                <Select value={f.status} onValueChange={(v) => set('status', v)}>
                  <SelectTrigger className="font-mono mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>{POSITION_STATUS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs font-mono text-muted-foreground">Linked Trade ID</Label>
                <Input value={f.linked_trade_id} onChange={(e) => set('linked_trade_id', e.target.value)} placeholder="T-001" className="font-mono mt-1" />
              </div>
              <div>
                <Label className="text-xs font-mono text-muted-foreground">Spot Exchange</Label>
                <Select value={f.spot_exchange || undefined} onValueChange={(v) => set('spot_exchange', v)}>
                  <SelectTrigger className="font-mono mt-1"><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>{EXCHANGES.map(e => <SelectItem key={e} value={e}>{e}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs font-mono text-muted-foreground">Perp Exchange</Label>
                <Select value={f.perp_exchange || undefined} onValueChange={(v) => set('perp_exchange', v)}>
                  <SelectTrigger className="font-mono mt-1"><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>{EXCHANGES.map(e => <SelectItem key={e} value={e}>{e}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              {numField('spot_qty', 'Spot Qty')}
              {numField('perp_qty', 'Perp Qty (negative for short)')}
              {numField('spot_mark', 'Spot Mark')}
              {numField('perp_mark', 'Perp Mark')}
              {numField('spot_notional', 'Spot Notional')}
              {numField('perp_notional', 'Perp Notional')}
              {numField('net_delta_usd', 'Net Delta USD')}
              {numField('collateral_balance', 'Collateral Balance')}
              {numField('margin_used', 'Margin Used')}
              {numField('margin_utilization_pct', 'Margin Utilization % (decimal)')}
              {numField('liq_distance_pct', 'Liq Distance % (decimal)')}
              {numField('funding_next', 'Funding Next')}
            </div>
            <div>
              <Label className="text-xs font-mono text-muted-foreground">Notes</Label>
              <Textarea value={f.notes} onChange={(e) => set('notes', e.target.value)} className="font-mono mt-1 min-h-[70px]" />
            </div>
            <div className="flex justify-end gap-3">
              <Button type="button" variant="outline" onClick={() => { setShowForm(false); setEditing(null); }}>Cancel</Button>
              <Button type="submit" disabled={persist.isPending}>{persist.isPending ? 'Saving…' : editing ? 'Update' : 'Create'}</Button>
            </div>
          </form>
        </Section>
      )}

      <Section title="All Position Snapshots">
        {isLoading ? (
          <p className="text-center py-8 text-muted-foreground font-mono text-sm">Loading…</p>
        ) : positions.length === 0 ? (
          <EmptyState title="No position snapshots" subtitle="Log intraday snapshots to track delta, margin, and liquidation distance." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs font-mono whitespace-nowrap">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border">
                  <th className="text-left py-2 px-2 font-medium">Age</th>
                  <th className="text-left py-2 px-2 font-medium">Time</th>
                  <th className="text-left font-medium">Status</th>
                  <th className="text-left font-medium">Asset</th>
                  <th className="text-left font-medium">Spot Ex</th>
                  <th className="text-left font-medium">Perp Ex</th>
                  <th className="text-right font-medium">Spot Qty</th>
                  <th className="text-right font-medium">Perp Qty</th>
                  <th className="text-right font-medium">Net Δ</th>
                  <th className="text-right font-medium">Margin</th>
                  <th className="text-right font-medium">Util %</th>
                  <th className="text-right font-medium">Liq Dist %</th>
                  <th className="text-left font-medium">Trade</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {positions.map(p => {
                   const ageInfo = getAgeCategory(p.snapshot_time);
                   return (
                   <tr key={p.id} className="border-b border-border/30 hover:bg-secondary/40 cursor-pointer" onClick={() => openForm(p)}>
                     <td className="py-2 px-2">
                       <div className="flex items-center gap-2">
                         <div className={`w-2 h-2 rounded-full ${ageInfo.color}`} title={ageInfo.label} />
                         <span className="text-muted-foreground text-xs">{ageInfo.age}</span>
                       </div>
                     </td>
                     <td className="py-2 px-2 text-muted-foreground">{p.snapshot_time ? new Date(p.snapshot_time).toLocaleString() : '—'}</td>
                     <td><StatusBadge status={p.status} /></td>
                    <td className="font-bold">{p.asset}</td>
                    <td>{p.spot_exchange || '—'}</td>
                    <td>{p.perp_exchange || '—'}</td>
                    <td className="text-right">{p.spot_qty != null ? Number(p.spot_qty).toFixed(4) : '—'}</td>
                    <td className="text-right">{p.perp_qty != null ? Number(p.perp_qty).toFixed(4) : '—'}</td>
                    <td className={`text-right ${Math.abs(p.net_delta_usd || 0) < 50 ? 'text-accent' : 'text-destructive'}`}>{fmtUSD(p.net_delta_usd)}</td>
                    <td className="text-right text-muted-foreground">{fmtUSD(p.margin_used)}</td>
                    <td className="text-right">{p.margin_utilization_pct != null ? `${(p.margin_utilization_pct * 100).toFixed(1)}%` : '—'}</td>
                    <td className="text-right">{p.liq_distance_pct != null ? `${(p.liq_distance_pct * 100).toFixed(1)}%` : '—'}</td>
                    <td className="text-primary">{p.linked_trade_id || '—'}</td>
                    <td className="text-right">
                      <Button variant="ghost" size="icon" className="h-6 w-6" onClick={(e) => { e.stopPropagation(); if (confirm('Delete this snapshot?')) del.mutate(p.id); }}>
                        <Trash2 className="w-3 h-3 text-destructive" />
                      </Button>
                    </td>
                    </tr>
                    );
                    })}
                    </tbody>
            </table>
          </div>
        )}
      </Section>
    </div>
  );
}