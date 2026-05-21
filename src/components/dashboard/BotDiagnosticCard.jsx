import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Activity, CheckCircle2, XCircle, AlertTriangle, ExternalLink, RefreshCw } from 'lucide-react';
import { base44 } from '@/api/base44Client';

function formatAge(seconds) {
  if (seconds == null) return '—';
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

export default function BotDiagnosticCard() {
  const [health, setHealth] = useState(null);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    setLoading(true);
    try {
      const res = await base44.functions.invoke('dropletHealth', {});
      setHealth(res.data);
    } catch (e) {
      console.error('BotDiagnosticCard error:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 30_000);
    return () => clearInterval(interval);
  }, []);

  const heartbeatSec  = health?.heartbeat?.last_seen_sec;
  // Only treat as down if missing >5 min (300s) — avoids false alarms on minor delays
  const heartbeatOk   = heartbeatSec != null && heartbeatSec < 300;
  const heartbeatCritical = heartbeatSec == null || heartbeatSec >= 600; // truly offline >10min
  const posted        = health?.heartbeat?.total_posted_last_hour || 0;
  const accepted      = health?.connectivity?.signals_accepted_last_hour || 0;
  const non2xx        = health?.connectivity?.non_2xx_last_hour || 0;
  const postErrors    = health?.connectivity?.post_errors_last_hour || 0;

  // SINGLE SOURCE OF TRUTH: use dropletHealth's overall_status (same as /droplet-health page)
  const overall = health?.overall_status; // 'healthy' | 'warning' | 'critical' | 'unknown'
  const overallOk = overall === 'healthy';

  // Auth status: only "failing" if we actually see non-2xx rejections from Base44.
  // 0% accepted with 0 non-2xx means signals were filter-rejected (edge/asset rules) — NOT auth failure.
  let authStatus;
  if (!health) authStatus = 'loading';
  else if (non2xx > 2) authStatus = 'failing';
  else if (postErrors > 2) authStatus = 'network_error';
  else if (posted === 0 && accepted === 0 && heartbeatSec != null && heartbeatSec < 300) authStatus = 'unknown';
  else authStatus = 'ok';

  // Signal flow label: distinguish filter rejections from auth rejections
  const signalFlowStatus = health?.signal_flow?.status; // 'flowing' | 'no_opportunities' | 'blocked' | 'degraded'

  return (
    <Card className={
      overallOk ? 'border-green-500/30 bg-green-500/5'
      : overall === 'critical' ? 'border-red-500/40 bg-red-500/5'
      : overall === 'warning' ? 'border-yellow-500/40 bg-yellow-500/5'
      : 'border-border'
    }>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <Activity className="w-4 h-4" />Bot Diagnostics
          </CardTitle>
          <Button variant="ghost" size="icon" onClick={refresh} disabled={loading} className="h-7 w-7">
            <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Heartbeat */}
        <div className="flex items-center justify-between text-sm">
          <div className="flex items-center gap-2">
            {heartbeatOk
              ? <CheckCircle2 className="w-4 h-4 text-green-400" />
              : <XCircle className="w-4 h-4 text-red-400" />}
            <span>Heartbeat</span>
          </div>
          <span className={`font-mono text-xs ${heartbeatOk ? 'text-green-400' : 'text-red-400'}`}>
            {formatAge(heartbeatSec)}
          </span>
        </div>

        {/* Auth Status */}
        <div className="flex items-center justify-between text-sm">
          <div className="flex items-center gap-2">
            {authStatus === 'ok'
              ? <CheckCircle2 className="w-4 h-4 text-green-400" />
              : authStatus === 'failing'
                ? <XCircle className="w-4 h-4 text-red-400" />
                : <AlertTriangle className="w-4 h-4 text-gray-400" />}
            <span>Token Auth</span>
          </div>
          <span className={`font-mono text-xs ${
            authStatus === 'ok' ? 'text-green-400'
            : authStatus === 'failing' ? 'text-red-400'
            : authStatus === 'network_error' ? 'text-yellow-400'
            : authStatus === 'loading' ? 'text-muted-foreground'
            : 'text-muted-foreground'
          }`}>
            {authStatus === 'ok' ? 'OK'
              : authStatus === 'failing' ? `${non2xx} rejected`
              : authStatus === 'network_error' ? `${postErrors} net errors`
              : authStatus === 'loading' ? 'loading...'
              : 'no data yet'}
          </span>
        </div>

        {/* Signal flow snapshot */}
        <div className="flex items-center justify-between text-sm">
          <div className="flex items-center gap-2">
            <Activity className={`w-4 h-4 ${signalFlowStatus === 'flowing' ? 'text-green-400' : signalFlowStatus === 'blocked' ? 'text-red-400' : 'text-muted-foreground'}`} />
            <span>Signals (last hour)</span>
          </div>
          <span className="font-mono text-xs">
            {!health
              ? <span className="text-muted-foreground">loading...</span>
              : signalFlowStatus === 'no_opportunities'
              ? <span className="text-muted-foreground">market quiet · {posted} scanned</span>
              : signalFlowStatus === 'blocked'
                ? <span className="text-red-400">blocked · {posted} rejected</span>
                : <>
                    <span className="text-green-400">{accepted}</span>
                    <span className="text-muted-foreground"> / {posted} posted</span>
                  </>
            }
          </span>
        </div>

        {/* P0 Action: only show restart if TRULY critical (>10min no heartbeat) */}
        {heartbeatCritical && (
          <div className="mt-3 p-3 rounded bg-red-500/10 border border-red-500/30">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[10px] font-mono bg-red-500/30 text-red-200 px-1.5 py-0.5 rounded">P0</span>
              <span className="text-xs font-semibold text-red-200">Droplet bot offline — restart required</span>
            </div>
            <code className="block text-[11px] font-mono text-red-300/80 mt-1 break-all">
              systemctl restart arb-bot-v2 && journalctl -u arb-bot-v2 -n 30 --no-pager
            </code>
          </div>
        )}

        {heartbeatOk && authStatus === 'failing' && (
          <div className="mt-3 p-3 rounded bg-yellow-500/10 border border-yellow-500/30">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[10px] font-mono bg-yellow-500/30 text-yellow-200 px-1.5 py-0.5 rounded">P0</span>
              <span className="text-xs font-semibold text-yellow-200">BOT_SECRET mismatch — fix .env on droplet</span>
            </div>
            <p className="text-[11px] text-yellow-300/80 mt-1">
              Go to Health page → click "Get Fix Script" to regenerate .env with correct secrets.
            </p>
          </div>
        )}

        <Link to="/droplet-health">
          <Button variant="ghost" size="sm" className="w-full text-xs mt-2">
            <ExternalLink className="w-3 h-3 mr-1" />Full health details
          </Button>
        </Link>
      </CardContent>
    </Card>
  );
}