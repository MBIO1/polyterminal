import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { toast } from 'sonner';
import { Copy } from 'lucide-react';
import { 
  CheckCircle2, 
  XCircle, 
  AlertTriangle, 
  RefreshCw,
  Wifi,
  Signal,
  Clock,
  RotateCcw,
  Settings,
  Upload,
  Wrench,
  Terminal,
  FlaskConical,
  Trash2,
  Key,
  Download
} from 'lucide-react';

const STATUS_CONFIG = {
  healthy: { 
    icon: CheckCircle2, 
    color: 'text-green-500', 
    bg: 'bg-green-500/10', 
    border: 'border-green-500/30',
    label: 'Healthy'
  },
  critical: { 
    icon: XCircle, 
    color: 'text-red-500', 
    bg: 'bg-red-500/10', 
    border: 'border-red-500/30',
    label: 'Critical'
  },
  warning: { 
    icon: AlertTriangle, 
    color: 'text-yellow-500', 
    bg: 'bg-yellow-500/10', 
    border: 'border-yellow-500/30',
    label: 'Warning'
  },
  no_data: {
    icon: AlertTriangle,
    color: 'text-gray-500',
    bg: 'bg-gray-500/10',
    border: 'border-gray-500/30',
    label: 'No Data'
  }
};

export default function DropletHealthCheck() {
  const [health, setHealth] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [lastCheck, setLastCheck] = useState(new Date());
  const [actionLoading, setActionLoading] = useState(null);
  const [scriptModal, setScriptModal] = useState(null); // { title, script }
  const [testTradeResult, setTestTradeResult] = useState(null);

  const runAction = async (fnName, label) => {
    setActionLoading(fnName);
    try {
      const res = await base44.functions.invoke(fnName, {});
      // If the response contains a shell script or one_liner, show it in a modal
      if (res.data?.script || res.data?.full_script || res.data?.one_liner) {
        setScriptModal({ 
          title: label, 
          script: res.data.full_script || res.data.script, 
          one_liner: res.data.one_liner,
          message: res.data.message,
          instructions: res.data.instructions,
        });
        toast.info(`${label}: Script ready — copy and run on droplet`);
      } else {
        toast.success(`${label}: ${res.data?.status || res.data?.message || 'Done'}`);
      }
      setTimeout(checkHealth, 2000);
    } catch (e) {
      toast.error(`${label} failed: ${e.message}`);
    } finally {
      setActionLoading(null);
    }
  };

  const runTestTrade = async () => {
    setActionLoading('triggerTestTrade');
    setTestTradeResult(null);
    try {
      const res = await base44.functions.invoke('triggerTestTrade', {});
      setTestTradeResult(res.data);
      toast.success(`Test trade created: ${res.data.tradeId} — ${res.data.finalStatus}`);
    } catch (e) {
      toast.error(`Test trade failed: ${e.message}`);
      setTestTradeResult({ error: e.message });
    } finally {
      setActionLoading(null);
    }
  };

  const checkHealth = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await base44.functions.invoke('dropletHealth', {});
      setHealth(res.data);
      setLastCheck(new Date());
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    checkHealth();
    const interval = setInterval(checkHealth, 30000);
    return () => clearInterval(interval);
  }, []);

  if (!health && !error && loading) {
    return (
      <div className="p-6 flex items-center justify-center">
        <RefreshCw className="w-8 h-8 animate-spin" />
        <span className="ml-2">Loading health data...</span>
      </div>
    );
  }

  const status = health?.overall_status || 'no_data';
  const config = STATUS_CONFIG[status] || STATUS_CONFIG.no_data;

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold">Droplet Health</h1>
          <p className="text-muted-foreground mt-1">Monitor and control the arbitrage bot droplet</p>
        </div>
        <Button onClick={checkHealth} disabled={loading} variant="outline">
          <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
          {loading ? 'Checking...' : 'Refresh'}
        </Button>
      </div>

      {/* Bot Action Buttons */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Bot Controls</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Button
              onClick={() => runAction('deployBot', 'Deploy Bot')}
              disabled={!!actionLoading}
              className="bg-primary hover:bg-primary/90"
            >
              {actionLoading === 'deployBot'
                ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                : <Upload className="w-4 h-4 mr-2" />}
              Deploy Bot
            </Button>

            <Button
              onClick={() => runAction('restartDroplet', 'Restart Bot')}
              disabled={!!actionLoading}
              variant="secondary"
            >
              {actionLoading === 'restartDroplet'
                ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                : <RotateCcw className="w-4 h-4 mr-2" />}
              Restart Bot
            </Button>

            <Button
              onClick={() => runAction('setupDroplet', 'Setup Droplet')}
              disabled={!!actionLoading}
              variant="outline"
            >
              {actionLoading === 'setupDroplet'
                ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                : <Settings className="w-4 h-4 mr-2" />}
              Setup Droplet
            </Button>

            <Button
              onClick={() => runAction('testDropletConnection', 'Test Connection')}
              disabled={!!actionLoading}
              variant="outline"
            >
              {actionLoading === 'testDropletConnection'
                ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                : <Wifi className="w-4 h-4 mr-2" />}
              Test Connection
            </Button>

            <Button
              onClick={() => runAction('fixBotEnv', 'Fix Bot Env')}
              disabled={!!actionLoading}
              variant="outline"
              className="border-yellow-500/40 text-yellow-400 hover:bg-yellow-500/10"
            >
              {actionLoading === 'fixBotEnv'
                ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                : <Wrench className="w-4 h-4 mr-2" />}
              Fix Bot Env
            </Button>

            <Button
              onClick={() => runAction('installPm2', 'Install PM2')}
              disabled={!!actionLoading}
              variant="outline"
              className="border-blue-500/40 text-blue-400 hover:bg-blue-500/10"
            >
              {actionLoading === 'installPm2'
                ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                : <Terminal className="w-4 h-4 mr-2" />}
              Install PM2
            </Button>

            <Button
              onClick={runTestTrade}
              disabled={!!actionLoading}
              variant="outline"
              className="border-purple-500/40 text-purple-400 hover:bg-purple-500/10"
            >
              {actionLoading === 'triggerTestTrade'
                ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                : <FlaskConical className="w-4 h-4 mr-2" />}
              Test Trade ($1)
            </Button>

            <Button
              onClick={() => runAction('deployArbBot', 'Deploy Arb Bot')}
              disabled={!!actionLoading}
              variant="outline"
              className="border-cyan-500/40 text-cyan-400 hover:bg-cyan-500/10"
            >
              {actionLoading === 'deployArbBot'
                ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                : <Download className="w-4 h-4 mr-2" />}
              🚀 Deploy Arb Bot
            </Button>

            <Button
              onClick={() => runAction('downloadRunner', 'Download runner.mjs')}
              disabled={!!actionLoading}
              variant="outline"
              className="border-orange-500/40 text-orange-400 hover:bg-orange-500/10"
            >
              {actionLoading === 'downloadRunner'
                ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                : <Download className="w-4 h-4 mr-2" />}
              📄 Download runner.mjs
            </Button>

            <Button
              onClick={() => runAction('fixBotExport', 'Fix bot.mjs Export')}
              disabled={!!actionLoading}
              variant="outline"
              className="border-pink-500/40 text-pink-400 hover:bg-pink-500/10"
            >
              {actionLoading === 'fixBotExport'
                ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                : <Wrench className="w-4 h-4 mr-2" />}
              🔧 Fix bot.mjs Export
            </Button>

            <Button
              onClick={() => runAction('cleanDroplet', 'Clean Droplet')}
              disabled={!!actionLoading}
              variant="outline"
              className="border-red-500/40 text-red-400 hover:bg-red-500/10"
            >
              {actionLoading === 'cleanDroplet'
                ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                : <Trash2 className="w-4 h-4 mr-2" />}
              Clean Droplet
            </Button>

            <Button
              onClick={() => runAction('getFixScript', 'Fix Env Now')}
              disabled={!!actionLoading}
              variant="outline"
              className="border-green-500/40 text-green-400 hover:bg-green-500/10"
            >
              {actionLoading === 'getFixScript'
                ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                : <Key className="w-4 h-4 mr-2" />}
              🔑 Fix Env Now
            </Button>

            <Button
              onClick={() => runAction('killSystemdBot', 'Kill Systemd Crash Loop')}
              disabled={!!actionLoading}
              variant="outline"
              className="border-red-500/60 text-red-300 hover:bg-red-500/10 col-span-2 md:col-span-2 font-bold"
            >
              {actionLoading === 'killSystemdBot'
                ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                : <Trash2 className="w-4 h-4 mr-2" />}
              🚨 Kill Systemd Crash Loop (Run This!)
            </Button>
          </div>
          <p className="text-xs text-muted-foreground mt-3 font-mono">
            <b>📄 Download runner.mjs</b> — quick fix when runner.mjs is missing (PM2 error).<br/>
            <b>🚀 Deploy Arb Bot</b> — full deployment: creates directory, downloads bot files, sets up .env, starts PM2.<br/>
            <b>Test Trade ($1)</b> — creates a paper $1 BTC trade, pings order-server, records result in ArbTrades.<br/>
            <b>Clean Droplet</b> — kills all other bots, rewrites env with fresh secrets, restarts only Base44 arb-bot.
          </p>

          {/* Test Trade Result */}
          {testTradeResult && (
            <div className={`mt-4 p-3 rounded text-xs font-mono ${testTradeResult.error ? 'bg-red-500/10 border border-red-500/30 text-red-300' : 'bg-purple-500/10 border border-purple-500/30 text-purple-200'}`}>
              {testTradeResult.error ? (
                <span>❌ {testTradeResult.error}</span>
              ) : (
                <div className="space-y-1">
                  <div>✅ <b>Trade ID:</b> {testTradeResult.tradeId}</div>
                  <div>📋 <b>Status:</b> {testTradeResult.finalStatus}</div>
                  {testTradeResult.dropletResult && (
                    <div>🔗 <b>Droplet:</b> {JSON.stringify(testTradeResult.dropletResult)}</div>
                  )}
                  {testTradeResult.error && (
                    <div>⚠️ {testTradeResult.error}</div>
                  )}
                  <div className="text-muted-foreground mt-1">→ Check the <b>Trades</b> page for this record.</div>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Card className={`${config.bg} ${config.border}`}>
        <CardContent className="pt-6">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-4">
              <config.icon className={`w-12 h-12 ${config.color}`} />
              <div>
                <h2 className="text-2xl font-bold">{config.label}</h2>
                <p className="text-muted-foreground">Last checked: {lastCheck.toLocaleTimeString()}</p>
              </div>
            </div>
            {status === 'critical' && (
              <Button
                onClick={() => runAction('restartDroplet', 'Restart Bot')}
                disabled={!!actionLoading}
                className="bg-red-500/20 text-red-200 hover:bg-red-500/30 border border-red-500/40"
              >
                {actionLoading === 'restartDroplet'
                  ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                  : <RotateCcw className="w-4 h-4 mr-2" />}
                Restart Bot Now
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {health && (
        <>
          {/* Issues Summary */}
          {health.issues?.length > 0 && (
            <Card className="border-yellow-500/40 bg-yellow-500/5">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2 text-yellow-300">
                  <AlertTriangle className="w-4 h-4" />Issues Detected
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="text-sm space-y-1 list-disc list-inside text-yellow-200">
                  {health.issues.map((issue, i) => <li key={i}>{issue}</li>)}
                </ul>
              </CardContent>
            </Card>
          )}

          {/* Recommendations */}
          {health.recommendations?.length > 0 && (
            <Card className="border-blue-500/40 bg-blue-500/5">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2 text-blue-300">
                  <Wrench className="w-4 h-4" />Recommended Actions
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="text-sm space-y-3">
                  {health.recommendations.map((rec, i) => (
                    <li key={i} className="text-blue-200">
                      <div className="flex items-start gap-2 flex-wrap">
                        <span className="font-mono text-xs bg-blue-500/20 px-1.5 py-0.5 rounded">{rec.priority}</span>
                        <b className="flex-1">{rec.action}</b>
                        {rec.action?.toLowerCase().includes('restart') && (
                          <Button
                            size="sm"
                            onClick={() => runAction('restartDroplet', 'Restart Bot')}
                            disabled={!!actionLoading}
                            className="bg-red-500/20 text-red-200 hover:bg-red-500/30 border border-red-500/40 h-7 text-xs"
                          >
                            {actionLoading === 'restartDroplet'
                              ? <RefreshCw className="w-3 h-3 mr-1 animate-spin" />
                              : <RotateCcw className="w-3 h-3 mr-1" />}
                            Run Now
                          </Button>
                        )}
                      </div>
                      <div className="text-xs text-blue-300/80 ml-12 mt-1 font-mono">{rec.details}</div>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card className={health.heartbeat?.status === 'critical' ? 'border-red-500/40 bg-red-500/5' : ''}>
              <CardHeader>
                <CardTitle className="text-sm flex items-center gap-2">
                  <Clock className="w-4 h-4" />Heartbeat
                </CardTitle>
              </CardHeader>
              <CardContent>
                <Badge variant={health.heartbeat?.status === 'healthy' ? 'default' : 'destructive'}>
                  {health.heartbeat?.status}
                </Badge>
                <div className="text-sm mt-2 space-y-1">
                  <div>Last seen: <b>{health.heartbeat?.last_seen_sec}s ago</b></div>
                  <div>Heartbeats: {health.heartbeat?.heartbeats_last_hour}/hr</div>
                  <div>Evaluations: {health.heartbeat?.total_evaluations_last_hour?.toLocaleString()}</div>
                  <div>Bot posted: {health.heartbeat?.total_posted_last_hour}/hr</div>
                </div>
              </CardContent>
            </Card>

            <Card className={health.connectivity?.non_2xx_last_hour > 0 ? 'border-red-500/40 bg-red-500/5' : ''}>
              <CardHeader>
                <CardTitle className="text-sm flex items-center gap-2">
                  <Wifi className="w-4 h-4" />Ingest Success
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {health.connectivity?.ingest_success_rate_pct ?? '—'}%
                  <span className="text-xs text-muted-foreground ml-2">accepted</span>
                </div>
                <div className="text-sm mt-2 space-y-1">
                  <div>Bot posted: <b>{health.heartbeat?.total_posted_last_hour}</b></div>
                  <div>Base44 accepted: <b className="text-green-400">{health.connectivity?.signals_accepted_last_hour}</b></div>
                  <div>Rejected (non-2xx): <b className="text-red-400">{health.connectivity?.non_2xx_last_hour}</b></div>
                  <div>Network errors: {health.connectivity?.post_errors_last_hour}</div>
                </div>
                {health.connectivity?.non_2xx_last_hour > 5 && (
                  <Button
                    size="sm"
                    onClick={() => runAction('getFixScript', 'Fix Env Now')}
                    disabled={!!actionLoading}
                    className="bg-green-500/20 text-green-300 hover:bg-green-500/30 border border-green-500/30 w-full text-xs mt-3"
                  >
                    {actionLoading === 'getFixScript'
                      ? <RefreshCw className="w-3 h-3 mr-1 animate-spin" />
                      : <Key className="w-3 h-3 mr-1" />}
                    Get Fix Script (BOT_SECRET)
                  </Button>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-sm flex items-center gap-2">
                  <Signal className="w-4 h-4" />Signal Flow
                </CardTitle>
              </CardHeader>
              <CardContent>
                <Badge variant={health.signal_flow?.status === 'flowing' ? 'default' : 'secondary'}>
                  {health.signal_flow?.status}
                </Badge>
                <div className="text-sm mt-2 space-y-1">
                  <div>Accepted: <b>{health.signal_flow?.signals_ingested_last_hour}</b>/hr</div>
                  <div>Posted by bot: {health.signal_flow?.signals_posted_by_bot_last_hour}/hr</div>
                  {health.signal_flow?.last_signal_at && (
                    <div className="text-xs text-muted-foreground">
                      Last: {new Date(health.signal_flow.last_signal_at).toLocaleTimeString()}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Diagnostics */}
          {health.diagnostics && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Latest Heartbeat Diagnostics</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                  <div>
                    <div className="text-muted-foreground">Best edge</div>
                    <div className="font-mono font-bold">{health.diagnostics.best_edge_bps?.toFixed(2)} bps</div>
                    <div className="text-muted-foreground text-[10px]">{health.diagnostics.best_edge_pair}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">Venue checks</div>
                    <div className="font-mono">{health.diagnostics.venue_pair_checks?.toLocaleString()}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">Rejected (edge)</div>
                    <div className="font-mono text-yellow-400">{health.diagnostics.rejected_edge?.toLocaleString()}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">Rejected (fillable)</div>
                    <div className="font-mono text-yellow-400">{health.diagnostics.rejected_fillable?.toLocaleString()}</div>
                  </div>
                </div>
                <div className="mt-3 pt-3 border-t border-border">
                  <div className="text-xs text-muted-foreground mb-1">Spread distribution:</div>
                  <div className="grid grid-cols-5 gap-2 text-xs font-mono">
                    <div>0-5: <span className="text-muted-foreground">{health.diagnostics.bucket_distribution?.['0-5_bps']}</span></div>
                    <div>5-10: <span className="text-blue-400">{health.diagnostics.bucket_distribution?.['5-10_bps']}</span></div>
                    <div>10-15: <span className="text-green-400">{health.diagnostics.bucket_distribution?.['10-15_bps']}</span></div>
                    <div>15-20: <span className="text-yellow-400">{health.diagnostics.bucket_distribution?.['15-20_bps']}</span></div>
                    <div>20+: <span className="text-green-300 font-bold">{health.diagnostics.bucket_distribution?.['20+_bps']}</span></div>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}

      {/* Script Modal */}
      {scriptModal && (
        <Card className="border-green-500/30 bg-green-500/5">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Terminal className="w-4 h-4 text-green-400" />
              {scriptModal.title} — Run on Droplet
            </CardTitle>
            <Button variant="ghost" size="sm" onClick={() => setScriptModal(null)}>✕</Button>
          </CardHeader>
          <CardContent className="space-y-4">
            {scriptModal.message && (
              <p className="text-sm text-yellow-300 font-semibold">{scriptModal.message}</p>
            )}

            {scriptModal.instructions && (
              <ol className="text-xs text-muted-foreground space-y-1 list-decimal list-inside">
                {scriptModal.instructions.map((s, i) => <li key={i}>{s}</li>)}
              </ol>
            )}

            {scriptModal.one_liner && (
              <div className="space-y-1">
                <p className="text-xs text-green-400 font-semibold">⚡ Quick Fix (one-liner):</p>
                <div className="flex gap-2 items-start">
                  <pre className="bg-secondary/80 rounded p-3 text-xs font-mono overflow-x-auto flex-1 text-green-300 whitespace-pre-wrap">
                    {scriptModal.one_liner}
                  </pre>
                  <Button size="sm" variant="ghost" className="text-green-400 shrink-0"
                    onClick={() => { navigator.clipboard.writeText(scriptModal.one_liner); toast.success('One-liner copied!'); }}>
                    <Copy className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            )}

            {scriptModal.script && (
              <div className="space-y-1">
                <p className="text-xs text-yellow-400 font-semibold">📋 Full script (recommended):</p>
                <pre className="bg-secondary/80 rounded p-4 text-xs font-mono overflow-x-auto whitespace-pre-wrap max-h-96 overflow-y-auto text-green-200">
                  {scriptModal.script}
                </pre>
                <Button
                  size="sm"
                  onClick={() => { navigator.clipboard.writeText(scriptModal.script); toast.success('Full script copied!'); }}
                  className="bg-green-500/20 text-green-300 hover:bg-green-500/30 border border-green-500/30"
                >
                  <Copy className="w-4 h-4 mr-2" />Copy Full Script
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}