/**
 * Live Trading Hub
 * 
 * Consolidated live trading panel:
 * - Wallet balance (USDC + MATIC)
 * - Pre-flight system audit
 * - CLOB connectivity test
 * - Manual order execution (via server-side signing)
 * - Live trades log
 * 
 * Does NOT touch paper trading logic.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';
import {
  Wallet, Zap, Shield, CheckCircle, XCircle, Loader2,
  AlertTriangle, RefreshCw, Send, Activity, Lock,
  TrendingUp, TrendingDown, Clock, DollarSign,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

// ── Helpers ────────────────────────────────────────────────────────────────────
const Card = ({ children, className = '' }) => (
  <div className={`rounded-xl border border-border bg-card p-5 ${className}`}>{children}</div>
);

const Row = ({ label, value, color = 'text-foreground' }) => (
  <div className="flex justify-between items-center py-1.5 border-b border-border/30 last:border-0">
    <span className="text-xs text-muted-foreground">{label}</span>
    <span className={`text-xs font-mono font-bold ${color}`}>{value}</span>
  </div>
);

const StatusDot = ({ ok }) => (
  <span className={`inline-block w-2 h-2 rounded-full flex-shrink-0 ${
    ok === true ? 'bg-accent' : ok === false ? 'bg-destructive' : 'bg-chart-4 animate-pulse'
  }`} />
);

const Badge = ({ label, ok }) => (
  <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-mono font-bold
    ${ok === true ? 'bg-accent/10 text-accent' : ok === false ? 'bg-destructive/10 text-destructive' : 'bg-chart-4/10 text-chart-4'}`}>
    <StatusDot ok={ok} />
    {label}
  </span>
);

// BTC YES token for quick test
const BTC_YES_TOKEN = '21742633143463906290569050155826241533067272736897614950488156847949938836455';
const BTC_NO_TOKEN  = '48331043336612883890938759509493159234755048973500640148014422747788308965732';
const ETH_YES_TOKEN = '69236923620077691027083946871148646972011131466059644796204542240861588995922';
const ETH_NO_TOKEN  = '87584955359245246404952128082451897287778571240979823316620093987046202296587';

const TOKEN_OPTIONS = [
  { label: 'BTC YES (5min up)',   value: BTC_YES_TOKEN },
  { label: 'BTC NO (5min down)', value: BTC_NO_TOKEN },
  { label: 'ETH YES (5min up)',  value: ETH_YES_TOKEN },
  { label: 'ETH NO (5min down)', value: ETH_NO_TOKEN },
];

export default function LiveTradingHub() {
  const queryClient = useQueryClient();

  // ── State ──────────────────────────────────────────────────────────────────
  const [walletData, setWalletData] = useState(null);
  const [walletLoading, setWalletLoading] = useState(false);
  const [creds, setCreds] = useState(null);
  const [connStatus, setConnStatus] = useState(null); // null | 'testing' | 'ok' | 'error'
  const [connError, setConnError] = useState('');
  const [auditData, setAuditData] = useState(null);
  const [auditLoading, setAuditLoading] = useState(false);
  const [paperMode, setPaperMode] = useState(true);

  const [orderForm, setOrderForm] = useState({
    tokenId: BTC_YES_TOKEN,
    side: 0, // 0=BUY YES, 1=BUY NO
    price: 0.52,
    sizeUsdc: 1,
  });
  const [placingOrder, setPlacingOrder] = useState(false);

  // ── Live trades from DB ────────────────────────────────────────────────────
  const { data: liveTrades = [] } = useQuery({
    queryKey: ['live-trades'],
    queryFn: () => base44.entities.BotTrade.filter({ mode: 'live' }, '-created_date', 30),
    refetchInterval: 15000,
  });

  // ── Load creds + mode on mount ─────────────────────────────────────────────
  useEffect(() => {
    base44.functions.invoke('polyCredentials', { action: 'check' })
      .then(r => setCreds(r.data))
      .catch(() => setCreds({ allSet: false }));
    base44.functions.invoke('botRunner', { action: 'status' })
      .then(r => setPaperMode(r.data?.config?.paper_trading !== false))
      .catch(() => {});
    fetchWalletBalance();
  }, []);

  // ── Wallet balance ─────────────────────────────────────────────────────────
  const fetchWalletBalance = async () => {
    setWalletLoading(true);
    try {
      const r = await base44.functions.invoke('walletBalance', {});
      setWalletData(r.data);
    } catch (err) {
      toast.error(`Balance fetch failed: ${err.message}`);
    } finally {
      setWalletLoading(false);
    }
  };

  // ── CLOB connectivity test ─────────────────────────────────────────────────
  const handleTestConnection = async () => {
    setConnStatus('testing');
    setConnError('');
    try {
      const r = await base44.functions.invoke('polyTestConnection', {});
      const d = r.data;
      if (!d?.clobReachable) throw new Error('CLOB unreachable');
      setConnStatus('ok');
      toast.success('CLOB reachable ✓');
    } catch (err) {
      setConnStatus('error');
      setConnError(err.message);
      toast.error(`Connection failed: ${err.message}`);
    }
  };

  // ── System audit ──────────────────────────────────────────────────────────
  const handleRunAudit = async () => {
    setAuditLoading(true);
    try {
      const r = await base44.functions.invoke('liveTradeAudit', {});
      setAuditData(r.data);
      if (r.data?.readiness) {
        toast.success('System ready for live trading ✓');
      } else {
        toast.warning(`Not ready: ${r.data?.failures?.[0] || 'check audit'}`);
      }
    } catch (err) {
      toast.error(`Audit failed: ${err.message}`);
    } finally {
      setAuditLoading(false);
    }
  };

  // ── Place manual order ────────────────────────────────────────────────────
  const handlePlaceOrder = async () => {
    if (paperMode) {
      toast.error('Switch to Live mode first — currently in Paper Trading mode');
      return;
    }
    if (!creds?.allSet) {
      toast.error('API credentials not set');
      return;
    }
    if (orderForm.sizeUsdc < 1 || orderForm.sizeUsdc > 50) {
      toast.error('Size must be $1–$50');
      return;
    }
    setPlacingOrder(true);
    try {
      const r = await base44.functions.invoke('autoSignAndExecute', {
        tokenId: orderForm.tokenId,
        side: orderForm.side,
        price: Number(orderForm.price),
        sizeUsdc: Number(orderForm.sizeUsdc),
      });
      if (r.data?.success) {
        toast.success(`✅ Live order placed! ID: ${r.data.orderId?.slice(0, 12)}…`);
        queryClient.invalidateQueries({ queryKey: ['live-trades'] });
        fetchWalletBalance();
      } else {
        throw new Error(r.data?.error || 'Order failed');
      }
    } catch (err) {
      toast.error(`Order failed: ${err.message}`);
    } finally {
      setPlacingOrder(false);
    }
  };

  // ── Computed ──────────────────────────────────────────────────────────────
  const livePnl = liveTrades.reduce((s, t) => s + (t.pnl_usdc || 0), 0);
  const liveWins = liveTrades.filter(t => t.outcome === 'win').length;
  const liveLosses = liveTrades.filter(t => t.outcome === 'loss').length;
  const livePending = liveTrades.filter(t => t.outcome === 'pending').length;
  const liveWinRate = (liveWins + liveLosses) > 0 ? (liveWins / (liveWins + liveLosses) * 100).toFixed(1) : '—';

  const readyForLive = creds?.allSet && connStatus === 'ok' && !paperMode && walletData?.balance_usdc > 0;

  return (
    <div className="p-4 md:p-6 max-w-[1400px] mx-auto space-y-6">

      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Live Trading Hub</h1>
          <p className="text-xs text-muted-foreground mt-1 font-mono">
            Polymarket CLOB · EIP-712 server-side signing · Polygon mainnet
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge label={paperMode ? 'PAPER MODE' : 'LIVE MODE'} ok={!paperMode} />
          <Badge label={creds?.allSet ? 'CREDS SET' : 'CREDS MISSING'} ok={creds?.allSet} />
          <Badge label={connStatus === 'ok' ? 'CLOB OK' : connStatus === 'error' ? 'CLOB FAIL' : 'UNTESTED'} ok={connStatus === 'ok' ? true : connStatus === 'error' ? false : null} />
        </div>
      </div>

      {/* Mode warning */}
      {paperMode && (
        <div className="rounded-xl border border-chart-4/30 bg-chart-4/5 p-4 flex items-start gap-3">
          <AlertTriangle className="w-4 h-4 text-chart-4 mt-0.5 flex-shrink-0" />
          <div className="text-xs text-muted-foreground">
            <strong className="text-chart-4">Paper Trading is active.</strong> No real orders will execute. To place live orders, go to <strong className="text-foreground">Bot Dashboard</strong> and toggle to Live mode, or use the <strong className="text-foreground">Trading Engine</strong> page.
          </div>
        </div>
      )}

      {/* Live mode warning */}
      {!paperMode && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 flex items-start gap-3">
          <AlertTriangle className="w-4 h-4 text-destructive mt-0.5 flex-shrink-0" />
          <p className="text-xs text-muted-foreground">
            <strong className="text-destructive">🔴 LIVE TRADING IS ACTIVE.</strong> Orders placed here will use real USDC from your Polygon wallet. Double-check size before submitting.
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* ── LEFT COLUMN ──────────────────────────────────────────────────── */}
        <div className="space-y-4">

          {/* Wallet Balance */}
          <Card>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Wallet className="w-4 h-4 text-primary" />
                <h3 className="text-sm font-semibold text-foreground">Wallet Balance</h3>
              </div>
              <button
                onClick={fetchWalletBalance}
                disabled={walletLoading}
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${walletLoading ? 'animate-spin' : ''}`} />
              </button>
            </div>

            {walletData?.error ? (
              <p className="text-xs text-destructive font-mono">{walletData.error}</p>
            ) : walletLoading && !walletData ? (
              <div className="flex items-center gap-2 py-4 text-xs text-muted-foreground">
                <Loader2 className="w-4 h-4 animate-spin" /> Fetching balance…
              </div>
            ) : (
              <div className="space-y-3">
                <div className="rounded-lg bg-secondary/40 border border-border p-4 text-center">
                  <p className="text-[10px] font-mono text-muted-foreground mb-1">USDC BALANCE</p>
                  <p className="text-3xl font-bold font-mono text-foreground">
                    ${walletData?.balance_usdc?.toFixed(2) ?? '—'}
                  </p>
                  <p className="text-[10px] text-muted-foreground mt-1">on Polygon mainnet</p>
                </div>
                <Row
                  label="MATIC (gas)"
                  value={walletData?.balance_matic != null ? `${walletData.balance_matic.toFixed(4)} MATIC` : '—'}
                  color={walletData?.gas_ok ? 'text-accent' : 'text-destructive'}
                />
                {!walletData?.gas_ok && walletData?.balance_matic != null && (
                  <p className="text-[10px] text-destructive font-mono">⚠️ Low MATIC — need ≥0.01 for gas</p>
                )}
                <Row
                  label="Wallet"
                  value={walletData?.wallet ? `${walletData.wallet.slice(0, 8)}…${walletData.wallet.slice(-6)}` : '—'}
                />
                {walletData?.timestamp && (
                  <p className="text-[9px] text-muted-foreground font-mono">
                    Updated {new Date(walletData.timestamp).toLocaleTimeString()}
                  </p>
                )}
              </div>
            )}
          </Card>

          {/* Credentials */}
          <Card>
            <div className="flex items-center gap-2 mb-4">
              <Lock className="w-4 h-4 text-primary" />
              <h3 className="text-sm font-semibold text-foreground">API Credentials</h3>
            </div>
            {!creds ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> Checking…
              </div>
            ) : (
              <div className="space-y-2">
                {[
                  { label: 'Wallet Address', value: creds.walletAddress },
                  { label: 'Private Key',    value: creds.privateKey },
                  { label: 'API Key',        value: creds.apiKey },
                  { label: 'API Secret',     value: creds.apiSecret },
                  { label: 'Passphrase',     value: creds.passphrase },
                ].map(({ label, value }) => (
                  <div key={label} className="flex items-center justify-between gap-2">
                    <span className="text-[10px] text-muted-foreground font-mono">{label}</span>
                    <span className={`text-[10px] font-mono ${value ? 'text-accent' : 'text-destructive'}`}>
                      {value || '✗ NOT SET'}
                    </span>
                  </div>
                ))}
                <div className={`mt-2 rounded-lg p-2.5 flex items-center gap-2 text-xs font-mono font-bold
                  ${creds.allSet ? 'bg-accent/10 text-accent' : 'bg-destructive/10 text-destructive'}`}>
                  {creds.allSet ? <CheckCircle className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />}
                  {creds.allSet ? 'All credentials set ✓' : 'Missing — check Dashboard → Env Vars'}
                </div>
              </div>
            )}
          </Card>

          {/* Connectivity */}
          <Card>
            <div className="flex items-center gap-2 mb-4">
              <Activity className="w-4 h-4 text-primary" />
              <h3 className="text-sm font-semibold text-foreground">CLOB Connectivity</h3>
            </div>
            <div className="space-y-1 mb-4">
              <Row label="Endpoint" value="clob.polymarket.com" />
              <Row label="Chain" value="Polygon (137)" />
              <Row label="Status" value={connStatus === 'ok' ? 'Reachable' : connStatus === 'error' ? 'Failed' : 'Untested'}
                color={connStatus === 'ok' ? 'text-accent' : connStatus === 'error' ? 'text-destructive' : 'text-muted-foreground'} />
              {connError && <p className="text-[10px] text-destructive font-mono pt-1">{connError}</p>}
            </div>
            <Button
              onClick={handleTestConnection}
              size="sm"
              variant="outline"
              className="w-full"
              disabled={connStatus === 'testing'}
            >
              {connStatus === 'testing'
                ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />Testing…</>
                : <><Zap className="w-3.5 h-3.5 mr-1.5" />Test Connection</>
              }
            </Button>
          </Card>
        </div>

        {/* ── CENTER COLUMN ─────────────────────────────────────────────────── */}
        <div className="space-y-4">

          {/* Manual Order */}
          <Card>
            <div className="flex items-center gap-2 mb-4">
              <Send className="w-4 h-4 text-accent" />
              <h3 className="text-sm font-semibold text-foreground">Manual Order</h3>
              <span className="text-[10px] font-mono text-muted-foreground ml-auto">server-side EIP-712</span>
            </div>

            <div className="space-y-3">
              {/* Token select */}
              <div>
                <label className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider block mb-1">Market</label>
                <select
                  className="w-full rounded-md border border-border bg-secondary/30 px-3 py-2 text-xs font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
                  value={orderForm.tokenId}
                  onChange={e => setOrderForm(f => ({ ...f, tokenId: e.target.value }))}
                >
                  {TOKEN_OPTIONS.map(o => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>

              {/* Custom Token ID */}
              <div>
                <label className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider block mb-1">Token ID (or paste custom)</label>
                <Input
                  className="font-mono text-xs"
                  value={orderForm.tokenId}
                  onChange={e => setOrderForm(f => ({ ...f, tokenId: e.target.value }))}
                  placeholder="Polymarket token ID"
                />
              </div>

              {/* Side */}
              <div>
                <label className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider block mb-1">Side</label>
                <div className="flex rounded-md overflow-hidden border border-border">
                  {[{ label: 'BUY YES', val: 0 }, { label: 'BUY NO', val: 1 }].map(({ label, val }) => (
                    <button
                      key={val}
                      onClick={() => setOrderForm(f => ({ ...f, side: val }))}
                      className={`flex-1 py-2 text-xs font-mono font-bold transition-colors
                        ${orderForm.side === val
                          ? val === 0 ? 'bg-accent text-accent-foreground' : 'bg-destructive text-destructive-foreground'
                          : 'text-muted-foreground hover:bg-secondary'
                        }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Price + Size */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider block mb-1">Price (0–1)</label>
                  <Input
                    type="number" min="0.01" max="0.99" step="0.01"
                    className="font-mono text-xs"
                    value={orderForm.price}
                    onChange={e => setOrderForm(f => ({ ...f, price: parseFloat(e.target.value) || 0.5 }))}
                  />
                </div>
                <div>
                  <label className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider block mb-1">Size (USDC)</label>
                  <Input
                    type="number" min="1" max="50" step="1"
                    className="font-mono text-xs"
                    value={orderForm.sizeUsdc}
                    onChange={e => setOrderForm(f => ({ ...f, sizeUsdc: parseFloat(e.target.value) || 1 }))}
                  />
                </div>
              </div>

              {/* Preview */}
              <div className="rounded-lg bg-secondary/40 border border-border p-3 space-y-1">
                <p className="text-[10px] font-mono text-muted-foreground uppercase mb-1.5">Preview</p>
                <Row label="Shares" value={(orderForm.sizeUsdc / orderForm.price).toFixed(2)} />
                <Row label="Max win" value={`+$${(orderForm.sizeUsdc * ((1 - orderForm.price) / orderForm.price)).toFixed(2)}`} color="text-accent" />
                <Row label="Max loss" value={`-$${orderForm.sizeUsdc}`} color="text-destructive" />
                <Row label="Fee (~7.2%)" value={`~$${(orderForm.sizeUsdc * 0.072).toFixed(3)}`} color="text-chart-4" />
              </div>

              <Button
                onClick={handlePlaceOrder}
                disabled={placingOrder || paperMode || !creds?.allSet}
                className="w-full bg-accent hover:bg-accent/90 font-mono"
              >
                {placingOrder
                  ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />Placing…</>
                  : paperMode
                  ? '⚠️ Switch to Live Mode First'
                  : <><Send className="w-3.5 h-3.5 mr-1.5" />Place ${orderForm.sizeUsdc} Live Order</>
                }
              </Button>
            </div>
          </Card>

          {/* System Audit */}
          <Card>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Shield className="w-4 h-4 text-primary" />
                <h3 className="text-sm font-semibold text-foreground">Pre-Flight Audit</h3>
              </div>
              {auditData && (
                <span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded
                  ${auditData.readiness ? 'bg-accent/10 text-accent' : 'bg-destructive/10 text-destructive'}`}>
                  {auditData.readiness ? '✅ READY' : '❌ NOT READY'}
                </span>
              )}
            </div>

            {auditData ? (
              <div className="space-y-2 mb-4">
                <Row label="User Role" value={auditData.authorization?.userRole || '—'} color={auditData.authorization?.isAdmin ? 'text-accent' : 'text-destructive'} />
                <Row label="Bot Running" value={auditData.system?.botRunning ? 'Yes' : 'No'} color={auditData.system?.botRunning ? 'text-accent' : 'text-muted-foreground'} />
                <Row label="Paper Mode" value={auditData.system?.paperTradingMode ? 'Yes' : 'No'} color={auditData.system?.paperTradingMode ? 'text-chart-4' : 'text-accent'} />
                <Row label="CLOB Reachable" value={auditData.system?.clobReachable || '—'} color={auditData.system?.clobReachable === 'OK' ? 'text-accent' : 'text-destructive'} />
                <Row label="Open Positions" value={auditData.system?.pendingTrades ?? '—'} />
                <Row label="Consecutive Losses" value={auditData.system?.consecutiveLosses ?? '—'} color={(auditData.system?.consecutiveLosses || 0) >= 5 ? 'text-destructive' : 'text-foreground'} />
                {auditData.failures?.length > 0 && (
                  <div className="mt-2 rounded-lg bg-destructive/5 border border-destructive/20 p-3 space-y-1">
                    {auditData.failures.map((f, i) => (
                      <p key={i} className="text-[10px] text-destructive font-mono">• {f}</p>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground py-4 text-center">Run audit to check system readiness</p>
            )}

            <Button
              onClick={handleRunAudit}
              size="sm"
              variant="outline"
              className="w-full"
              disabled={auditLoading}
            >
              {auditLoading
                ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />Running…</>
                : <><Shield className="w-3.5 h-3.5 mr-1.5" />Run System Audit</>
              }
            </Button>
          </Card>
        </div>

        {/* ── RIGHT COLUMN ──────────────────────────────────────────────────── */}
        <div className="space-y-4">

          {/* Live P&L Summary */}
          <Card>
            <div className="flex items-center gap-2 mb-4">
              <DollarSign className="w-4 h-4 text-primary" />
              <h3 className="text-sm font-semibold text-foreground">Live Trade Stats</h3>
            </div>
            <div className="space-y-1">
              <Row label="Total Live Trades" value={liveTrades.length} />
              <Row label="Wins" value={liveWins} color="text-accent" />
              <Row label="Losses" value={liveLosses} color="text-destructive" />
              <Row label="Pending" value={livePending} color="text-primary" />
              <Row label="Win Rate" value={liveWinRate !== '—' ? `${liveWinRate}%` : '—'} color={parseFloat(liveWinRate) >= 50 ? 'text-accent' : 'text-destructive'} />
              <Row
                label="Realized P&L"
                value={`${livePnl >= 0 ? '+' : ''}$${livePnl.toFixed(2)}`}
                color={livePnl >= 0 ? 'text-accent' : 'text-destructive'}
              />
            </div>
          </Card>

          {/* Recent live trades */}
          <Card>
            <div className="flex items-center gap-2 mb-4">
              <Activity className="w-4 h-4 text-primary" />
              <h3 className="text-sm font-semibold text-foreground">Recent Live Trades</h3>
            </div>
            {liveTrades.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-8">No live trades yet</p>
            ) : (
              <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
                {liveTrades.slice(0, 15).map(trade => (
                  <div
                    key={trade.id}
                    className={`rounded-lg border p-3 text-xs ${
                      trade.outcome === 'win' ? 'border-accent/20 bg-accent/5' :
                      trade.outcome === 'loss' ? 'border-destructive/20 bg-destructive/5' :
                      'border-border bg-secondary/20'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-1.5">
                        <span className={`font-mono font-bold text-[10px] px-1.5 py-0.5 rounded
                          ${trade.asset === 'BTC' ? 'bg-chart-4/10 text-chart-4' : 'bg-primary/10 text-primary'}`}>
                          {trade.asset}
                        </span>
                        <span className="font-mono text-muted-foreground text-[10px]">
                          {trade.contract_type?.replace(/_/g, ' ')} · {trade.side?.toUpperCase()}
                        </span>
                      </div>
                      <span className={`font-mono font-bold text-[10px]
                        ${trade.outcome === 'win' ? 'text-accent' :
                          trade.outcome === 'loss' ? 'text-destructive' :
                          'text-primary animate-pulse'}`}>
                        {trade.outcome === 'pending' ? '⏳ PENDING' :
                          trade.outcome === 'win' ? `+$${(trade.pnl_usdc || 0).toFixed(3)}` :
                          `-$${Math.abs(trade.pnl_usdc || 0).toFixed(3)}`}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-[9px] text-muted-foreground font-mono">
                      <span>Entry: {Math.round((trade.entry_price || 0) * 100)}¢ · Size: ${(trade.size_usdc || 0).toFixed(2)}</span>
                      <span>{new Date(trade.created_date).toLocaleTimeString()}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}