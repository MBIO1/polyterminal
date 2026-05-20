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
  const heartbeatOk   = heartbeatSec != null && heartbeatSec < 120;
  const posted        = health?.heartbeat?.total_posted_last_hour || 0;
  const accepted      = health?.connectivity?.signals_accepted_last_hour || 0;
  const non2xx        = health?.connectivity?.non_2xx_last_hour || 0;
  const successRate   = health?.connectivity?.ingest_success_rate_pct;

  // Auth status: clear as soon as recent signals are being accepted.
  // Only flag 'failing' when nothing is getting through (accepted=0) AND we're seeing rejections.
  let authStatus;
  if (posted === 0) authStatus = 'unknown';
  else if (accepted === 0 && non2xx > 0) authStatus = 'failing';
  else authStatus = 'ok';

  const overallOk = heartbeatOk && authStatus === 'ok';

  return (
    <Card className={
      overallOk ? 'border-green-500/30 bg-green-500/5'
      : !heartbeatOk ? 'border-red-500/40 bg-red-500/5'
      : 'border-yellow-500/40 bg-yellow-500/5'
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
            : 'text-muted-foreground'
          }`}>
            {authStatus === 'ok' ? `${successRate}% accepted`
              : authStatus === 'failing' ? `${non2xx}/${posted} rejected`
              : 'no posts yet'}
          </span>
        </div>

        {/* Signal flow snapshot */}
        <div className="flex items-center justify-between text-sm">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-muted-foreground" />
            <span>Signals (last hour)</span>
          </div>
          <span className="font-mono text-xs">
            <span className="text-green-400">{accepted}</span>
            <span className="text-muted-foreground"> / {posted} posted</span>
          </span>
        </div>

        {/* P0 Action when broken */}
        {!heartbeatOk && (
          <div className="mt-3 p-3 rounded bg-red-500/10 border border-red-500/30">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[10px] font-mono bg-red-500/30 text-red-200 px-1.5 py-0.5 rounded">P0</span>
              <span className="text-xs font-semibold text-red-200">Restart the droplet bot process</span>
            </div>
            <code className="block text-[11px] font-mono text-red-300/80 mt-1 break-all">
              ssh root@droplet → pm2 restart arb-bot && pm2 logs arb-bot --lines 30
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