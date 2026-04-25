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
import { EXCEPTION_TYPES, EXCEPTION_STATUS, SEVERITIES, EXCHANGES, ASSETS } from '@/lib/arbMath';

const init = (e) => ({
  exception_id: e?.exception_id || '',
  exception_date: e?.exception_date ? e.exception_date.slice(0, 16) : new Date().toISOString().slice(0, 16),
  type: e?.type || 'Execution',
  exchange: e?.exchange || '',
  asset: e?.asset || '',
  linked_trade_id: e?.linked_trade_id || '',
  status: e?.status || 'Open',
  severity: e?.severity || 'Medium',
  description: e?.description || '',
  action_taken: e?.action_taken || '',
  owner: e?.owner || '',
  resolved_date: e?.resolved_date ? e.resolved_date.slice(0, 16) : '',
});

export default function ArbExceptions() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [f, setF] = useState(init());

  const { data: exceptions = [], isLoading } = useQuery({
    queryKey: ['arb-exceptions-all'],
    queryFn: () => base44.asServiceRole.entities.ArbException.list('-exception_date', 500),
    staleTime: 5_000,
    refetchInterval: 15_000,
  });

  const create = useMutation({
    mutationFn: (d) => base44.entities.ArbException.create(d),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['arb-exceptions-all'] }); qc.invalidateQueries({ queryKey: ['arb-exceptions'] }); toast.success('Saved'); setShowForm(false); setEditing(null); },
    onError: (e) => toast.error(e.message),
  });
  const update = useMutation({
    mutationFn: ({ id, data }) => base44.entities.ArbException.update(id, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['arb-exceptions-all'] }); qc.invalidateQueries({ queryKey: ['arb-exceptions'] }); toast.success('Updated'); setShowForm(false); setEditing(null); },
    onError: (e) => toast.error(e.message),
  });
  const del = useMutation({
    mutationFn: (id) => base44.entities.ArbException.delete(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['arb-exceptions-all'] }); toast.success('Deleted'); },
  });

  const openForm = (e = null) => { setEditing(e); setF(init(e)); setShowForm(true); };
  const set = (k, v) => setF(prev => ({ ...prev, [k]: v }));

  const submit = (e) => {
    e.preventDefault();
    create.mutate(f); // create handles new; for edit switch
    if (editing) update.mutate({ id: editing.id, data: f });
  };

  const openCount = exceptions.filter(e => e.status === 'Open').length;
  const criticalCount = exceptions.filter(e => e.severity === 'Critical' && e.status === 'Open').length;

  return (
    <div className="p-4 md:p-6 lg:p-8 max-w-[1600px] mx-auto space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Exceptions Log</h1>
          <p className="text-sm text-muted-foreground mt-1 font-mono">
            {exceptions.length} total · <span className={openCount > 0 ? 'text-destructive font-bold' : ''}>{openCount} open</span>
            {criticalCount > 0 && <span className="text-destructive font-bold"> · {criticalCount} critical</span>}
          </p>
        </div>
        <Button onClick={() => openForm()}><Plus className="w-4 h-4 mr-2" /> New Exception</Button>
      </div>

      {showForm && (
        <Section
          title={editing ? `Edit ${editing.exception_id}` : 'New Exception'}
          action={<Button variant="ghost" size="icon" onClick={() => { setShowForm(false); setEditing(null); }}><X className="w-4 h-4" /></Button>}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (editing) update.mutate({ id: editing.id, data: f });
              else create.mutate(f);
            }}
            className="space-y-4"
          >
            <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-3">
              <div>
                <Label className="text-xs font-mono text-muted-foreground">Exception ID *</Label>
                <Input required value={f.exception_id} onChange={(e) => set('exception_id', e.target.value)} placeholder="E-001" className="font-mono mt-1" />
              </div>
              <div>
                <Label className="text-xs font-mono text-muted-foreground">Date</Label>
                <Input type="datetime-local" value={f.exception_date} onChange={(e) => set('exception_date', e.target.value)} className="font-mono mt-1" />
              </div>
              <div>
                <Label className="text-xs font-mono text-muted-foreground">Type</Label>
                <Select value={f.type} onValueChange={(v) => set('type', v)}>
                  <SelectTrigger className="font-mono mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>{EXCEPTION_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs font-mono text-muted-foreground">Severity</Label>
                <Select value={f.severity} onValueChange={(v) => set('severity', v)}>
                  <SelectTrigger className="font-mono mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>{SEVERITIES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs font-mono text-muted-foreground">Status</Label>
                <Select value={f.status} onValueChange={(v) => set('status', v)}>
                  <SelectTrigger className="font-mono mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>{EXCEPTION_STATUS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs font-mono text-muted-foreground">Exchange</Label>
                <Select value={f.exchange || undefined} onValueChange={(v) => set('exchange', v)}>
                  <SelectTrigger className="font-mono mt-1"><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>{EXCHANGES.map(e => <SelectItem key={e} value={e}>{e}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs font-mono text-muted-foreground">Asset</Label>
                <Select value={f.asset || undefined} onValueChange={(v) => set('asset', v)}>
                  <SelectTrigger className="font-mono mt-1"><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>{ASSETS.map(a => <SelectItem key={a} value={a}>{a}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs font-mono text-muted-foreground">Linked Trade ID</Label>
                <Input value={f.linked_trade_id} onChange={(e) => set('linked_trade_id', e.target.value)} placeholder="T-001" className="font-mono mt-1" />
              </div>
              <div>
                <Label className="text-xs font-mono text-muted-foreground">Owner</Label>
                <Input value={f.owner} onChange={(e) => set('owner', e.target.value)} placeholder="Desk / Ops / Eng" className="font-mono mt-1" />
              </div>
              <div>
                <Label className="text-xs font-mono text-muted-foreground">Resolved Date</Label>
                <Input type="datetime-local" value={f.resolved_date} onChange={(e) => set('resolved_date', e.target.value)} className="font-mono mt-1" />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <Label className="text-xs font-mono text-muted-foreground">Description</Label>
                <Textarea value={f.description} onChange={(e) => set('description', e.target.value)} className="font-mono mt-1 min-h-[80px]" />
              </div>
              <div>
                <Label className="text-xs font-mono text-muted-foreground">Action Taken</Label>
                <Textarea value={f.action_taken} onChange={(e) => set('action_taken', e.target.value)} className="font-mono mt-1 min-h-[80px]" />
              </div>
            </div>

            <div className="flex justify-end gap-3">
              <Button type="button" variant="outline" onClick={() => { setShowForm(false); setEditing(null); }}>Cancel</Button>
              <Button type="submit" disabled={create.isPending || update.isPending}>
                {(create.isPending || update.isPending) ? 'Saving…' : editing ? 'Update' : 'Create'}
              </Button>
            </div>
          </form>
        </Section>
      )}

      <Section title="All Exceptions" subtitle="Most recent first">
        {isLoading ? (
          <p className="text-center py-8 text-muted-foreground font-mono text-sm">Loading…</p>
        ) : exceptions.length === 0 ? (
          <EmptyState title="No exceptions logged" subtitle="Operational incidents, API issues, fills, margin, and recon events." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs font-mono whitespace-nowrap">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border">
                  <th className="text-left py-2 px-2 font-medium">ID</th>
                  <th className="text-left font-medium">Date</th>
                  <th className="text-left font-medium">Type</th>
                  <th className="text-left font-medium">Severity</th>
                  <th className="text-left font-medium">Status</th>
                  <th className="text-left font-medium">Exchange</th>
                  <th className="text-left font-medium">Asset</th>
                  <th className="text-left font-medium">Linked</th>
                  <th className="text-left font-medium">Description</th>
                  <th className="text-left font-medium">Owner</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {exceptions.map(e => (
                  <tr key={e.id} className="border-b border-border/30 hover:bg-secondary/40 cursor-pointer" onClick={() => openForm(e)}>
                    <td className="py-2 px-2 font-bold text-primary">{e.exception_id}</td>
                    <td className="text-muted-foreground">{e.exception_date ? new Date(e.exception_date).toLocaleString() : '—'}</td>
                    <td>{e.type}</td>
                    <td><StatusBadge status={e.severity} /></td>
                    <td><StatusBadge status={e.status} /></td>
                    <td>{e.exchange || '—'}</td>
                    <td className="font-bold">{e.asset || '—'}</td>
                    <td className="text-primary">{e.linked_trade_id || '—'}</td>
                    <td className="max-w-xs truncate text-muted-foreground">{e.description || '—'}</td>
                    <td>{e.owner || '—'}</td>
                    <td className="text-right">
                      <Button variant="ghost" size="icon" className="h-6 w-6" onClick={(ev) => { ev.stopPropagation(); if (confirm(`Delete ${e.exception_id}?`)) del.mutate(e.id); }}>
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