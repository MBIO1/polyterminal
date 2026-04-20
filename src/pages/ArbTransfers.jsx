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
import { TRANSFER_TYPES, TRANSFER_ASSETS, TRANSFER_STATUS, EXCHANGES, fmtUSD } from '@/lib/arbMath';

const init = (t) => ({
  transfer_id: t?.transfer_id || '',
  transfer_date: t?.transfer_date || new Date().toISOString().slice(0, 10),
  type: t?.type || 'Internal Transfer',
  asset: t?.asset || 'USDC',
  from_exchange: t?.from_exchange || '',
  to_exchange: t?.to_exchange || '',
  quantity: t?.quantity ?? '',
  price_fx: t?.price_fx ?? 1,
  usd_value: t?.usd_value ?? '',
  fee: t?.fee ?? 0,
  net_quantity: t?.net_quantity ?? '',
  purpose: t?.purpose || '',
  linked_trade_id: t?.linked_trade_id || '',
  expected_arrival: t?.expected_arrival ? t.expected_arrival.slice(0, 16) : '',
  actual_arrival: t?.actual_arrival ? t.actual_arrival.slice(0, 16) : '',
  status: t?.status || 'Planned',
  rebalance_impact_usd: t?.rebalance_impact_usd ?? '',
  notes: t?.notes || '',
});

export default function ArbTransfers() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [f, setF] = useState(init());

  const { data: transfers = [], isLoading } = useQuery({
    queryKey: ['arb-transfers'],
    queryFn: () => base44.entities.ArbTransfer.list('-transfer_date', 500),
  });

  const persist = useMutation({
    mutationFn: async ({ id, data }) => {
      const clean = { ...data };
      ['quantity', 'price_fx', 'usd_value', 'fee', 'net_quantity', 'rebalance_impact_usd'].forEach(k => {
        if (clean[k] === '' || clean[k] == null) clean[k] = null;
        else clean[k] = Number(clean[k]);
      });
      if (!clean.usd_value && clean.quantity && clean.price_fx) clean.usd_value = clean.quantity * clean.price_fx;
      if (!clean.net_quantity && clean.quantity != null) clean.net_quantity = clean.quantity - (clean.fee || 0);
      return id ? base44.entities.ArbTransfer.update(id, clean) : base44.entities.ArbTransfer.create(clean);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['arb-transfers'] }); toast.success('Saved'); setShowForm(false); setEditing(null); },
    onError: (e) => toast.error(e.message),
  });
  const del = useMutation({
    mutationFn: (id) => base44.entities.ArbTransfer.delete(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['arb-transfers'] }); toast.success('Deleted'); },
  });

  const openForm = (t = null) => { setEditing(t); setF(init(t)); setShowForm(true); };
  const set = (k, v) => setF(prev => ({ ...prev, [k]: v }));

  const numField = (k, label, step = 'any') => (
    <div>
      <Label className="text-xs font-mono text-muted-foreground">{label}</Label>
      <Input type="number" step={step} value={f[k] ?? ''} onChange={(e) => set(k, e.target.value)} className="font-mono mt-1" />
    </div>
  );

  return (
    <div className="p-4 md:p-6 lg:p-8 max-w-[1600px] mx-auto space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Transfers & Rebalances</h1>
          <p className="text-sm text-muted-foreground mt-1 font-mono">{transfers.length} entries</p>
        </div>
        <Button onClick={() => openForm()}><Plus className="w-4 h-4 mr-2" /> New Transfer</Button>
      </div>

      {showForm && (
        <Section
          title={editing ? `Edit ${editing.transfer_id}` : 'New Transfer'}
          action={<Button variant="ghost" size="icon" onClick={() => { setShowForm(false); setEditing(null); }}><X className="w-4 h-4" /></Button>}
        >
          <form onSubmit={(e) => { e.preventDefault(); persist.mutate({ id: editing?.id, data: f }); }} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-3">
              <div>
                <Label className="text-xs font-mono text-muted-foreground">Transfer ID *</Label>
                <Input required value={f.transfer_id} onChange={(e) => set('transfer_id', e.target.value)} placeholder="X-001" className="font-mono mt-1" />
              </div>
              <div>
                <Label className="text-xs font-mono text-muted-foreground">Date</Label>
                <Input type="date" value={f.transfer_date} onChange={(e) => set('transfer_date', e.target.value)} className="font-mono mt-1" />
              </div>
              <div>
                <Label className="text-xs font-mono text-muted-foreground">Type</Label>
                <Select value={f.type} onValueChange={(v) => set('type', v)}>
                  <SelectTrigger className="font-mono mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>{TRANSFER_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs font-mono text-muted-foreground">Status</Label>
                <Select value={f.status} onValueChange={(v) => set('status', v)}>
                  <SelectTrigger className="font-mono mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>{TRANSFER_STATUS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs font-mono text-muted-foreground">Asset</Label>
                <Select value={f.asset} onValueChange={(v) => set('asset', v)}>
                  <SelectTrigger className="font-mono mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>{TRANSFER_ASSETS.map(a => <SelectItem key={a} value={a}>{a}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs font-mono text-muted-foreground">From</Label>
                <Select value={f.from_exchange || undefined} onValueChange={(v) => set('from_exchange', v)}>
                  <SelectTrigger className="font-mono mt-1"><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>{EXCHANGES.map(e => <SelectItem key={e} value={e}>{e}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs font-mono text-muted-foreground">To</Label>
                <Select value={f.to_exchange || undefined} onValueChange={(v) => set('to_exchange', v)}>
                  <SelectTrigger className="font-mono mt-1"><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>{EXCHANGES.map(e => <SelectItem key={e} value={e}>{e}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs font-mono text-muted-foreground">Linked Trade ID</Label>
                <Input value={f.linked_trade_id} onChange={(e) => set('linked_trade_id', e.target.value)} placeholder="T-001" className="font-mono mt-1" />
              </div>
              {numField('quantity', 'Quantity')}
              {numField('price_fx', 'Price / FX')}
              {numField('usd_value', 'USD Value')}
              {numField('fee', 'Fee')}
              {numField('net_quantity', 'Net Quantity')}
              {numField('rebalance_impact_usd', 'Rebalance Impact USD')}
              <div>
                <Label className="text-xs font-mono text-muted-foreground">Expected Arrival</Label>
                <Input type="datetime-local" value={f.expected_arrival} onChange={(e) => set('expected_arrival', e.target.value)} className="font-mono mt-1" />
              </div>
              <div>
                <Label className="text-xs font-mono text-muted-foreground">Actual Arrival</Label>
                <Input type="datetime-local" value={f.actual_arrival} onChange={(e) => set('actual_arrival', e.target.value)} className="font-mono mt-1" />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <Label className="text-xs font-mono text-muted-foreground">Purpose</Label>
                <Input value={f.purpose} onChange={(e) => set('purpose', e.target.value)} className="font-mono mt-1" />
              </div>
              <div>
                <Label className="text-xs font-mono text-muted-foreground">Notes</Label>
                <Textarea value={f.notes} onChange={(e) => set('notes', e.target.value)} className="font-mono mt-1 min-h-[70px]" />
              </div>
            </div>

            <div className="flex justify-end gap-3">
              <Button type="button" variant="outline" onClick={() => { setShowForm(false); setEditing(null); }}>Cancel</Button>
              <Button type="submit" disabled={persist.isPending}>{persist.isPending ? 'Saving…' : editing ? 'Update' : 'Create'}</Button>
            </div>
          </form>
        </Section>
      )}

      <Section title="All Transfers" subtitle="Most recent first">
        {isLoading ? (
          <p className="text-center py-8 text-muted-foreground font-mono text-sm">Loading…</p>
        ) : transfers.length === 0 ? (
          <EmptyState title="No transfers recorded" subtitle="Log deposits, withdrawals, rebalances, and funding payments." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs font-mono whitespace-nowrap">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border">
                  <th className="text-left py-2 px-2 font-medium">ID</th>
                  <th className="text-left font-medium">Date</th>
                  <th className="text-left font-medium">Type</th>
                  <th className="text-left font-medium">Status</th>
                  <th className="text-left font-medium">Asset</th>
                  <th className="text-left font-medium">From → To</th>
                  <th className="text-right font-medium">Qty</th>
                  <th className="text-right font-medium">USD</th>
                  <th className="text-right font-medium">Fee</th>
                  <th className="text-right font-medium">Impact</th>
                  <th className="text-left font-medium">Purpose</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {transfers.map(t => (
                  <tr key={t.id} className="border-b border-border/30 hover:bg-secondary/40 cursor-pointer" onClick={() => openForm(t)}>
                    <td className="py-2 px-2 font-bold text-primary">{t.transfer_id}</td>
                    <td className="text-muted-foreground">{t.transfer_date}</td>
                    <td>{t.type}</td>
                    <td><StatusBadge status={t.status} /></td>
                    <td className="font-bold">{t.asset}</td>
                    <td className="text-muted-foreground">{t.from_exchange || '—'} → {t.to_exchange || '—'}</td>
                    <td className="text-right">{t.quantity != null ? Number(t.quantity).toLocaleString() : '—'}</td>
                    <td className="text-right">{fmtUSD(t.usd_value)}</td>
                    <td className="text-right text-destructive">{fmtUSD(t.fee)}</td>
                    <td className={`text-right ${(t.rebalance_impact_usd || 0) >= 0 ? 'text-accent' : 'text-destructive'}`}>{fmtUSD(t.rebalance_impact_usd)}</td>
                    <td className="max-w-xs truncate text-muted-foreground">{t.purpose || '—'}</td>
                    <td className="text-right">
                      <Button variant="ghost" size="icon" className="h-6 w-6" onClick={(e) => { e.stopPropagation(); if (confirm(`Delete ${t.transfer_id}?`)) del.mutate(t.id); }}>
                        <Trash2 className="w-3 h-3 text-destructive" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </div>
  );
}