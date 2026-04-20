import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';
import { Plus, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import Section from '@/components/arb/Section';
import EmptyState from '@/components/arb/EmptyState';
import StatusBadge from '@/components/arb/StatusBadge';
import {
  ASSETS, EXCHANGES, STRATEGIES, TRADE_STATUS, ORDER_TYPES, FEE_TYPES,
  fmtUSD, fmtBps, computeNetPnl, computeSpreadBps,
} from '@/lib/arbMath';

const init = (t) => ({
  trade_id: t?.trade_id || '',
  trade_date: t?.trade_date || new Date().toISOString().slice(0, 10),
  entry_timestamp: t?.entry_timestamp ? t.entry_timestamp.slice(0, 16) : '',
  exit_timestamp: t?.exit_timestamp ? t.exit_timestamp.slice(0, 16) : '',
  status: t?.status || 'Planned',
  strategy: t?.strategy || 'Cross-venue Perp/Perp',
  asset: t?.asset || 'BTC',
  spot_exchange: t?.spot_exchange || '',
  perp_exchange: t?.perp_exchange || '',
  direction: t?.direction || 'Long Spot / Short Perp',
  spot_entry_px: t?.spot_entry_px ?? '',
  perp_entry_px: t?.perp_entry_px ?? '',
  spot_exit_px: t?.spot_exit_px ?? '',
  perp_exit_px: t?.perp_exit_px ?? '',
  spot_qty: t?.spot_qty ?? '',
  perp_qty: t?.perp_qty ?? '',
  gross_spread_entry: t?.gross_spread_entry ?? '',
  gross_spread_exit: t?.gross_spread_exit ?? '',
  entry_spread_bps: t?.entry_spread_bps ?? '',
  exit_spread_bps: t?.exit_spread_bps ?? '',
  expected_funding: t?.expected_funding ?? '',
  realized_funding: t?.realized_funding ?? '',
  basis_pnl: t?.basis_pnl ?? '',
  spot_entry_fee: t?.spot_entry_fee ?? '',
  perp_entry_fee: t?.perp_entry_fee ?? '',
  spot_exit_fee: t?.spot_exit_fee ?? '',
  perp_exit_fee: t?.perp_exit_fee ?? '',
  borrow_conversion_cost: t?.borrow_conversion_cost ?? 0,
  expected_slippage: t?.expected_slippage ?? '',
  realized_slippage: t?.realized_slippage ?? '',
  total_realized_fees: t?.total_realized_fees ?? '',
  net_pnl: t?.net_pnl ?? '',
  net_pnl_bps: t?.net_pnl_bps ?? '',
  allocated_capital: t?.allocated_capital ?? '',
  margin_used: t?.margin_used ?? '',
  net_delta_usd: t?.net_delta_usd ?? 0,
  hold_hours: t?.hold_hours ?? '',
  entry_order_type: t?.entry_order_type || '',
  exit_order_type: t?.exit_order_type || '',
  entry_fee_type: t?.entry_fee_type || '',
  exit_fee_type: t?.exit_fee_type || '',
  entry_thesis: t?.entry_thesis || '',
  exit_reason: t?.exit_reason || '',
  review_notes: t?.review_notes || '',
  mode: t?.mode || 'paper',
});

const toNum = (v) => (v === '' || v == null ? null : Number(v));

export default function ArbTrades() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [f, setF] = useState(init());

  const { data: trades = [], isLoading } = useQuery({
    queryKey: ['arb-trades-all'],
    queryFn: () => base44.entities.ArbTrade.list('-trade_date', 500),
  });

  const persist = useMutation({
    mutationFn: async ({ id, data }) => {
      const clean = Object.fromEntries(
        Object.entries(data).map(([k, v]) => [k, typeof v === 'string' && !isNaN(v) && v !== '' && !['trade_id', 'trade_date', 'status', 'strategy', 'asset', 'spot_exchange', 'perp_exchange', 'direction', 'entry_order_type', 'exit_order_type', 'entry_fee_type', 'exit_fee_type', 'entry_thesis', 'exit_reason', 'review_notes', 'mode', 'entry_timestamp', 'exit_timestamp'].includes(k) ? Number(v) : v])
      );
      // Derive net_pnl if not provided
      if (clean.net_pnl === '' || clean.net_pnl == null) clean.net_pnl = computeNetPnl(clean);
      if ((clean.entry_spread_bps === '' || clean.entry_spread_bps == null) && clean.spot_entry_px && clean.perp_entry_px)
        clean.entry_spread_bps = computeSpreadBps(clean.spot_entry_px, clean.perp_entry_px);
      if ((clean.exit_spread_bps === '' || clean.exit_spread_bps == null) && clean.spot_exit_px && clean.perp_exit_px)
        clean.exit_spread_bps = computeSpreadBps(clean.spot_exit_px, clean.perp_exit_px);
      return id ? base44.entities.ArbTrade.update(id, clean) : base44.entities.ArbTrade.create(clean);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['arb-trades-all'] });
      qc.invalidateQueries({ queryKey: ['arb-trades'] });
      toast.success('Saved');
      setShowForm(false); setEditing(null);
    },
    onError: (e) => toast.error(e.message),
  });

  const del = useMutation({
    mutationFn: (id) => base44.entities.ArbTrade.delete(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['arb-trades-all'] }); toast.success('Deleted'); },
  });

  const openForm = (t = null) => { setEditing(t); setF(init(t)); setShowForm(true); };
  const set = (k, v) => setF(prev => ({ ...prev, [k]: v }));
  const submit = (e) => { e.preventDefault(); persist.mutate({ id: editing?.id, data: f }); };

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
          <h1 className="text-2xl font-bold text-foreground">Trades</h1>
          <p className="text-sm text-muted-foreground mt-1 font-mono">{trades.length} total trades logged</p>
        </div>
        <Button onClick={() => openForm()}><Plus className="w-4 h-4 mr-2" /> New Trade</Button>
      </div>

      {showForm && (
        <Section
          title={editing ? `Edit ${editing.trade_id}` : 'New Trade'}
          action={<Button variant="ghost" size="icon" onClick={() => { setShowForm(false); setEditing(null); }}><X className="w-4 h-4" /></Button>}
        >
          <form onSubmit={submit} className="space-y-5">
            <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-3">
              <div>
                <Label className="text-xs font-mono text-muted-foreground">Trade ID *</Label>
                <Input required value={f.trade_id} onChange={(e) => set('trade_id', e.target.value)} placeholder="T-001" className="font-mono mt-1" />
              </div>
              <div>
                <Label className="text-xs font-mono text-muted-foreground">Trade Date</Label>
                <Input type="date" value={f.trade_date} onChange={(e) => set('trade_date', e.target.value)} className="font-mono mt-1" />
              </div>
              <div>
                <Label className="text-xs font-mono text-muted-foreground">Status</Label>
                <Select value={f.status} onValueChange={(v) => set('status', v)}>
                  <SelectTrigger className="font-mono mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>{TRADE_STATUS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs font-mono text-muted-foreground">Mode</Label>
                <Select value={f.mode} onValueChange={(v) => set('mode', v)}>
                  <SelectTrigger className="font-mono mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="paper">paper</SelectItem><SelectItem value="live">live</SelectItem></SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs font-mono text-muted-foreground">Strategy</Label>
                <Select value={f.strategy} onValueChange={(v) => set('strategy', v)}>
                  <SelectTrigger className="font-mono mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>{STRATEGIES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs font-mono text-muted-foreground">Asset</Label>
                <Select value={f.asset} onValueChange={(v) => set('asset', v)}>
                  <SelectTrigger className="font-mono mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>{ASSETS.map(a => <SelectItem key={a} value={a}>{a}</SelectItem>)}</SelectContent>
                </Select>
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
              <div className="md:col-span-2">
                <Label className="text-xs font-mono text-muted-foreground">Direction</Label>
                <Input value={f.direction} onChange={(e) => set('direction', e.target.value)} className="font-mono mt-1" />
              </div>
              <div>
                <Label className="text-xs font-mono text-muted-foreground">Entry Timestamp</Label>
                <Input type="datetime-local" value={f.entry_timestamp} onChange={(e) => set('entry_timestamp', e.target.value)} className="font-mono mt-1" />
              </div>
              <div>
                <Label className="text-xs font-mono text-muted-foreground">Exit Timestamp</Label>
                <Input type="datetime-local" value={f.exit_timestamp} onChange={(e) => set('exit_timestamp', e.target.value)} className="font-mono mt-1" />
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {numField('spot_entry_px', 'Spot Entry Px')}
              {numField('perp_entry_px', 'Perp Entry Px')}
              {numField('spot_exit_px', 'Spot Exit Px')}
              {numField('perp_exit_px', 'Perp Exit Px')}
              {numField('spot_qty', 'Spot Qty')}
              {numField('perp_qty', 'Perp Qty')}
              {numField('gross_spread_entry', 'Gross Spread Entry')}
              {numField('gross_spread_exit', 'Gross Spread Exit')}
              {numField('entry_spread_bps', 'Entry Spread (bps)')}
              {numField('exit_spread_bps', 'Exit Spread (bps)')}
              {numField('expected_funding', 'Expected Funding')}
              {numField('realized_funding', 'Realized Funding')}
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {numField('spot_entry_fee', 'Spot Entry Fee')}
              {numField('perp_entry_fee', 'Perp Entry Fee')}
              {numField('spot_exit_fee', 'Spot Exit Fee')}
              {numField('perp_exit_fee', 'Perp Exit Fee')}
              {numField('borrow_conversion_cost', 'Borrow / Conv Cost')}
              {numField('expected_slippage', 'Expected Slippage')}
              {numField('realized_slippage', 'Realized Slippage')}
              {numField('total_realized_fees', 'Total Realized Fees')}
              {numField('basis_pnl', 'Basis PnL')}
              {numField('net_pnl', 'Net PnL (override)')}
              {numField('net_pnl_bps', 'Net PnL (bps)')}
              {numField('hold_hours', 'Hold Hours')}
              {numField('allocated_capital', 'Allocated Capital')}
              {numField('margin_used', 'Margin Used')}
              {numField('net_delta_usd', 'Net Delta USD')}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <div>
                <Label className="text-xs font-mono text-muted-foreground">Entry Order Type</Label>
                <Select value={f.entry_order_type || undefined} onValueChange={(v) => set('entry_order_type', v)}>
                  <SelectTrigger className="font-mono mt-1"><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>{ORDER_TYPES.filter(Boolean).map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs font-mono text-muted-foreground">Exit Order Type</Label>
                <Select value={f.exit_order_type || undefined} onValueChange={(v) => set('exit_order_type', v)}>
                  <SelectTrigger className="font-mono mt-1"><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>{ORDER_TYPES.filter(Boolean).map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs font-mono text-muted-foreground">Entry Fee Type</Label>
                <Select value={f.entry_fee_type || undefined} onValueChange={(v) => set('entry_fee_type', v)}>
                  <SelectTrigger className="font-mono mt-1"><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>{FEE_TYPES.filter(Boolean).map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs font-mono text-muted-foreground">Exit Fee Type</Label>
                <Select value={f.exit_fee_type || undefined} onValueChange={(v) => set('exit_fee_type', v)}>
                  <SelectTrigger className="font-mono mt-1"><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>{FEE_TYPES.filter(Boolean).map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <Label className="text-xs font-mono text-muted-foreground">Entry Thesis</Label>
                <Textarea value={f.entry_thesis} onChange={(e) => set('entry_thesis', e.target.value)} className="font-mono mt-1 min-h-[70px]" />
              </div>
              <div>
                <Label className="text-xs font-mono text-muted-foreground">Exit Reason</Label>
                <Textarea value={f.exit_reason} onChange={(e) => set('exit_reason', e.target.value)} className="font-mono mt-1 min-h-[70px]" />
              </div>
              <div>
                <Label className="text-xs font-mono text-muted-foreground">Review Notes</Label>
                <Textarea value={f.review_notes} onChange={(e) => set('review_notes', e.target.value)} className="font-mono mt-1 min-h-[70px]" />
              </div>
            </div>

            <div className="flex justify-end gap-3">
              <Button type="button" variant="outline" onClick={() => { setShowForm(false); setEditing(null); }}>Cancel</Button>
              <Button type="submit" disabled={persist.isPending}>{persist.isPending ? 'Saving…' : editing ? 'Update' : 'Create'}</Button>
            </div>
          </form>
        </Section>
      )}

      <Section title="All Trades" subtitle="Most recent first">
        {isLoading ? (
          <p className="text-center py-8 text-muted-foreground font-mono text-sm">Loading…</p>
        ) : trades.length === 0 ? (
          <EmptyState title="No trades logged" subtitle="Click New Trade to log your first cross-venue arbitrage." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs font-mono whitespace-nowrap">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border">
                  <th className="text-left py-2 px-2 font-medium">ID</th>
                  <th className="text-left font-medium">Date</th>
                  <th className="text-left font-medium">Status</th>
                  <th className="text-left font-medium">Asset</th>
                  <th className="text-left font-medium">Spot Ex</th>
                  <th className="text-left font-medium">Perp Ex</th>
                  <th className="text-right font-medium">Entry bps</th>
                  <th className="text-right font-medium">Exit bps</th>
                  <th className="text-right font-medium">Net PnL</th>
                  <th className="text-right font-medium">Net bps</th>
                  <th className="text-right font-medium">Margin</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {trades.map(t => {
                  const pnl = t.net_pnl ?? computeNetPnl(t);
                  return (
                    <tr key={t.id} className="border-b border-border/30 hover:bg-secondary/40 cursor-pointer" onClick={() => openForm(t)}>
                      <td className="py-2 px-2 font-bold text-primary">{t.trade_id}</td>
                      <td className="text-muted-foreground">{t.trade_date}</td>
                      <td><StatusBadge status={t.status} /></td>
                      <td className="font-bold">{t.asset}</td>
                      <td>{t.spot_exchange || '—'}</td>
                      <td>{t.perp_exchange || '—'}</td>
                      <td className="text-right">{fmtBps(t.entry_spread_bps)}</td>
                      <td className="text-right">{fmtBps(t.exit_spread_bps)}</td>
                      <td className={`text-right font-semibold ${pnl >= 0 ? 'text-accent' : 'text-destructive'}`}>{fmtUSD(pnl)}</td>
                      <td className="text-right">{fmtBps(t.net_pnl_bps)}</td>
                      <td className="text-right text-muted-foreground">{fmtUSD(t.margin_used)}</td>
                      <td className="text-right">
                        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={(e) => { e.stopPropagation(); if (confirm(`Delete ${t.trade_id}?`)) del.mutate(t.id); }}>
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