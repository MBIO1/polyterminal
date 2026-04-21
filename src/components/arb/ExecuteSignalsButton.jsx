import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Play, Loader2, FlaskConical } from 'lucide-react';
import { toast } from 'sonner';

export default function ExecuteSignalsButton() {
  const [busy, setBusy] = useState(null); // 'dry' | 'live' | null

  const run = async (dryRun) => {
    setBusy(dryRun ? 'dry' : 'live');
    try {
      const res = await base44.functions.invoke('executeSignals', {
        dry_run: dryRun,
        max_signals: 5,
        min_confirmed: 3,
      });
      const d = res.data || {};
      const summary = `Processed ${d.processed || 0} · Executed ${d.executed || 0} · Rejected ${d.rejected || 0}`;
      toast.success(dryRun ? `Dry run — ${summary}` : `Executed — ${summary}`, {
        description: d.results?.slice(0, 3).map(r =>
          `${r.pair || r.signal_id}: ${r.decision}${r.reasons ? ` (${r.reasons.join(',')})` : ''}`
        ).join(' · ') || 'See console for details',
      });
      console.log('executeSignals result', d);
    } catch (e) {
      toast.error('Execute failed', { description: e?.message || 'See console' });
      console.error(e);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <Button
        size="sm"
        variant="outline"
        onClick={() => run(true)}
        disabled={busy !== null}
        className="font-mono text-xs"
      >
        {busy === 'dry' ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> : <FlaskConical className="w-3.5 h-3.5 mr-1.5" />}
        Dry Run
      </Button>
      <Button
        size="sm"
        onClick={() => run(false)}
        disabled={busy !== null}
        className="font-mono text-xs bg-primary hover:bg-primary/90"
      >
        {busy === 'live' ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> : <Play className="w-3.5 h-3.5 mr-1.5" />}
        Execute Now
      </Button>
    </div>
  );
}