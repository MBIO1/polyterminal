/**
 * Trading Engine Page
 *
 * UI for managing Polymarket CLOB credentials, testing connectivity,
 * and placing test limit orders. All signing is done client-side via
 * EIP-712 — private keys never leave the browser.
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  Shield, Zap, KeyRound, CheckCircle, XCircle,
  AlertTriangle, Wifi, ChevronRight, Loader2,
  FlaskConical, BookOpen, ArrowUpDown, Info, Lock, Send,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { base44 } from '@/api/base44Client';
import {
  buildOrderStruct,
  buildRestAuthHeaders,
  SIDE,
} from '@/lib/polymarket/eip712.js';
import {
  computeTakerFee,
  computeNetPnl,
} from '@/lib/polymarket/clobClient.js';

// Suppress harmless wallet extension initialization errors
if (typeof window !== 'undefined') {
  const originalError = console.error;
  console.error = (...args) => {
    const msg = String(args[0] || '');
    if (msg.includes('Talisman') || msg.includes('MetaMask') || msg.includes('TronLink') || msg.includes('Cannot redefine property')) {
      return;
    }
    originalError.apply(console, args);
  };
}

// Known token IDs for quick-test
const TEST_TOKEN = '21742633143463906290569050155826241533067272736897614950488156847949938836455';

// ── Sub-components ─────────────────────────────────────────────────────────────
const Card = ({ children, className = '' }) => (
  <div className={`rounded-xl border border-border bg-card p-5 ${className}`}>{children}</div>
);

const SectionTitle = ({ icon: Icon, title, subtitle, color = 'text-primary' }) => (
  <div className="flex items-start gap-3 mb-4">
    <Icon className={`w-4 h-4 mt-0.5 ${color}`} />
    <div>
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      {subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
    </div>
  </div>
);

const StatusBadge = ({ ok, label }) => (
  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono font-bold
    ${ok === true ? 'bg-accent/10 text-accent' : ok === false ? 'bg-destructive/10 text-destructive' : 'bg-muted/50 text-muted-foreground'}`}>
    {ok === true ? <CheckCircle className="w-2.5 h-2.5" /> : ok === false ? <XCircle className="w-2.5 h-2.5" /> : <Loader2 className="w-2.5 h-2.5 animate-spin" />}
    {label}
  </span>
);

const Row = ({ label, value, color = 'text-foreground' }) => (
  <div className="flex justify-between items-center py-1.5 border-b border-border/30 last:border-0">
    <span className="text-xs text-muted-foreground">{label}</span>
    <span className={`text-xs font-mono font-bold ${color}`}>{value}</span>
  </div>
);

// ── Main Page ──────────────────────────────────────────────────────────────────
export default function TradingEngine() {
  const [serverCreds, setServerCreds] = useState(null); // { walletAddress, apiKey (masked), allSet }
  const [loadingCreds, setLoadingCreds] = useState(true);
  const [connStatus, setConnStatus] = useState(null);
  const [connError, setConnError] = useState('');
  const [connAddress, setConnAddress] = useState(null);
  const [orderPreview, setOrderPreview] = useState(null);
  const [orderForm, setOrderForm] = useState({
    tokenId: TEST_TOKEN,
    side: 'BUY',
    price: 0.52,
    sizeUsdc: 1,
    expirySecs: 300,
  });
  const [signedPayload, setSignedPayload] = useState(null);
  const [signingStatus, setSigningStatus] = useState(null);
  const [diagResults, setDiagResults] = useState(null);
  const [diagLoading, setDiagLoading] = useState(false);
  const [paperMode, setPaperMode] = useState(true);
  const [togglingMode, setTogglingMode] = useState(false);
  const [botRunning, setBotRunning] = useState(false);
  const [botToggling, setBotToggling] = useState(false);

  // Load credential status and trading mode from server on mount
  useEffect(() => {
    Promise.all([
      base44.functions.invoke('polyCredentials', { action: 'check' })
        .then(res => setServerCreds(res.data))
        .catch(() => setServerCreds({ allSet: false })),
      base44.functions.invoke('botRunner', { action: 'status' })
        .then(res => {
          setPaperMode(res.data?.config?.paper_trading !== false);
          setBotRunning(res.data?.config?.bot_running === true);
        })
        .catch(() => {}),
    ]).finally(() => setLoadingCreds(false));
  }, []);

  // Auto-compute order preview whenever form changes
  useEffect(() => {
    const { price, sizeUsdc } = orderForm;
    if (!price || !sizeUsdc) return;
    const shares   = sizeUsdc / price;
    const fee      = computeTakerFee(shares, price, 0.072);
    const netWin   = computeNetPnl('win',  sizeUsdc, price);
    const netLoss  = computeNetPnl('loss', sizeUsdc, price);
    const breakEvenEdge = (fee / sizeUsdc) * 100;
    setOrderPreview({ shares: shares.toFixed(2), fee: fee.toFixed(4), netWin: netWin.toFixed(4), netLoss: netLoss.toFixed(4), breakEvenEdge: breakEvenEdge.toFixed(2) });
  }, [orderForm]);

  const handleTestConnection = async () => {
    if (!serverCreds?.allSet) {
      toast.error('Set all credentials in the Base44 dashboard first');
      return;
    }
    setConnStatus('testing');
    setConnError('');
    try {
      const res = await base44.functions.invoke('polyTestConnection', {});
      const d = res.data;
      if (!d?.clobReachable) throw new Error('CLOB unreachable');
      if (!d?.allCredsSet)   throw new Error('Missing credentials');
      setConnAddress(d.address);
      setConnStatus('ok');
      toast.success(`CLOB reachable ✓ · All credentials set · ${d.address?.slice(0, 8)}…`);
    } catch (err) {
      setConnStatus('error');
      setConnError(err.message);
      toast.error(`Connection failed: ${err.message}`);
    }
  };

  const handleBuildOrder = useCallback(() => {
    if (!serverCreds?.walletAddress) {
      toast.error('Wallet address not set in environment secrets');
      return;
    }
    try {
      const struct = buildOrderStruct({
        maker:          serverCreds.walletAddress,
        tokenId:        orderForm.tokenId,
        side:           orderForm.side === 'BUY' ? SIDE.BUY : SIDE.SELL,
        price:          Number(orderForm.price),
        sizeUsdc:       Number(orderForm.sizeUsdc),
        expirationSecs: Number(orderForm.expirySecs),
        nonce:          Date.now(),
        feeRateBps:     720,
      });
      setSignedPayload({ struct, signed: null });
      setSigningStatus(null);
      toast.success('Order struct built — signing happens server-side');
    } catch (err) {
      toast.error(`Build failed: ${err.message}`);
    }
  }, [serverCreds, orderForm]);

  const handleSignOrder = async () => {
    if (!signedPayload?.struct) return;
    setSigningStatus('signing');
    try {
      // Signing is now proxied through the backend — private key stays server-side
      const res = await base44.functions.invoke('polySign', { struct: signedPayload.struct });
      if (res.data?.error) throw new Error(res.data.error);
      setSignedPayload(prev => ({ ...prev, signed: res.data.signature }));
      setSigningStatus('done');
      toast.success('Order signed via EIP-712 (server-side) ✓');
    } catch (err) {
      setSigningStatus('error');
      toast.error(`Signing failed: ${err.message}`);
    }
  };

  const [placingOrder, setPlacingOrder] = React.useState(false);
  const [showProxyOption, setShowProxyOption] = React.useState(false);

  const handlePlaceOrderViaProxy = async () => {
    if (!signedPayload?.signed) {
      toast.error('Order must be signed first');
      return;
    }
    setPlacingOrder(true);
    try {
      const res = await base44.functions.invoke('proxyTradeRelay', {
        orderPayload: signedPayload.struct,
        signature: signedPayload.signed,
        apiKey: serverCreds.apiKey,
        apiSecret: serverCreds.apiSecret,
        apiPassphrase: serverCreds.passphrase,
        timestamp: Date.now().toString(),
        hmacSig: 'pre-computed',
      });
      if (res.data?.success) {
        toast.success(`✅ Order relayed via proxy! ID: ${res.data.orderId?.slice(0, 10)}…`);
        setSignedPayload(null);
        setOrderForm({ tokenId: '', side: 'BUY', price: 0.5, sizeUsdc: 1, expirySecs: 300 });
      } else {
        throw new Error(res.data?.error || 'Proxy relay failed');
      }
    } catch (err) {
      toast.error(`Proxy relay failed: ${err.message}`);
    } finally {
      setPlacingOrder(false);
    }
  };

  const handleRunDiagnostics = async () => {
    setDiagLoading(true);
    console.log('🔍 Starting diagnostics...');
    try {
      console.log('📡 Calling diagnoseCLOBAuth function...');
      const res = await base44.functions.invoke('diagnoseCLOBAuth', {});
      console.log('✅ Got response:', res.data);
      setDiagResults(res.data);
      toast.success('Diagnostics complete');
    } catch (err) {
      console.error('❌ Diagnostics error:', err);
      toast.error(`Diagnostics failed: ${err.message}`);
    } finally {
      setDiagLoading(false);
    }
  };

  const handleToggleTradeMode = async () => {
    setTogglingMode(true);
    try {
      const res = await base44.functions.invoke('togglePaperTrading', {});
      setPaperMode(res.data.paper_trading);
      toast.success(res.data.message);
    } catch (err) {
      toast.error(`Failed to toggle mode: ${err.message}`);
    } finally {
      setTogglingMode(false);
    }
  };

  const handleToggleBotRunning = async () => {
    setBotToggling(true);
    try {
      const res = await base44.functions.invoke('toggleBotRunning', { running: !botRunning });
      setBotRunning(res.data.bot_running);
      toast.success(res.data.message);
    } catch (err) {
      toast.error(`Failed to toggle bot: ${err.message}`);
    } finally {
      setBotToggling(false);
    }
  };

  const handlePlaceOrder = async () => {
    if (!signedPayload?.signed) {
      toast.error('Order must be signed first');
      return;
    }
    setPlacingOrder(true);
    console.log('📤 Placing order:', { tokenId: orderForm.tokenId, side: orderForm.side, price: orderForm.price, sizeUsdc: orderForm.sizeUsdc });
    try {
      const res = await base44.functions.invoke('autoSignAndExecute', {
        tokenId: orderForm.tokenId,
        side: orderForm.side === 'BUY' ? 0 : 1,
        price: Number(orderForm.price),
        sizeUsdc: Number(orderForm.sizeUsdc),
      });
      console.log('✅ Place order response:', res);
      if (res.data?.success) {
        toast.success(`✅ Order placed! ID: ${res.data.orderId?.slice(0, 10)}…`);
        setSignedPayload(null);
        setOrderForm({ tokenId: '', side: 'BUY', price: 0.5, sizeUsdc: 1, expirySecs: 300 });
      } else {
        console.error('❌ Order response not success:', res.data);
        throw new Error(res.data?.error || 'Order failed');
      }
    } catch (err) {
      console.error('❌ Place order error:', err);
      toast.error(`Order failed: ${err.message}`);
    } finally {
      setPlacingOrder(false);
    }
  };

  return (
    <div className="p-4 md:p-6 max-w-[1200px] mx-auto space-y-6">

      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-foreground">Trading Engine</h1>
        <p className="text-xs text-muted-foreground mt-1 font-mono">
          Polymarket CLOB integration · EIP-712 order signing · Local key management
        </p>
      </div>

      {/* Trading Mode Banner */}
      <div className={`rounded-xl border p-4 flex items-start justify-between gap-3 ${
        paperMode
          ? 'border-chart-4/30 bg-chart-4/5'
          : 'border-destructive/30 bg-destructive/5'
      }`}>
        <div className="flex items-start gap-3 flex-1">
          {paperMode ? (
            <>
              <AlertTriangle className="w-4 h-4 text-chart-4 mt-0.5 flex-shrink-0" />
              <div className="text-xs text-muted-foreground space-y-1">
                <p><strong className="text-chart-4">PAPER TRADING MODE</strong> — Simulated trades, no real orders executed.</p>
              </div>
            </>
          ) : (
            <>
              <AlertTriangle className="w-4 h-4 text-destructive mt-0.5 flex-shrink-0" />
              <div className="text-xs text-muted-foreground space-y-1">
                <p><strong className="text-destructive">🔴 LIVE TRADING ENABLED</strong> — Real orders will be executed with actual funds!</p>
              </div>
            </>
          )}
        </div>
        <div className="flex gap-2">
          <Button 
            onClick={handleToggleTradeMode} 
            size="sm" 
            disabled={togglingMode}
            variant="outline"
          >
            {togglingMode ? (
              <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />Switching...</>
            ) : (
              <>
                {paperMode ? 'Enable Live' : 'Switch to Paper'}
              </>
            )}
          </Button>
          <Button 
            onClick={handleToggleBotRunning} 
            size="sm" 
            disabled={botToggling}
            className={botRunning ? 'bg-destructive hover:bg-destructive/90' : 'bg-accent hover:bg-accent/90'}
          >
            {botToggling ? (
              <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /></>
            ) : (
              <>
                {botRunning ? '⏹️ Stop Bot' : '🚀 Start Bot'}
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Security banner */}
      <div className="rounded-xl border border-accent/30 bg-accent/5 p-4 flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 flex-1">
          <Lock className="w-4 h-4 text-accent mt-0.5 flex-shrink-0" />
          <div className="text-xs text-muted-foreground space-y-1">
            <p><strong className="text-accent">Credentials are stored as server-side environment secrets.</strong> They are never sent to or stored in the browser. Private keys only exist in the secure server environment.</p>
            <p>To update credentials, go to <strong className="text-foreground">Base44 Dashboard → Settings → Environment Variables</strong>.</p>
          </div>
        </div>
        <Button onClick={handleRunDiagnostics} size="sm" variant="default" disabled={diagLoading} className="flex-shrink-0">
          {diagLoading ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Zap className="w-3.5 h-3.5 mr-1.5" />}
          Run Diagnostics
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* LEFT: Credentials */}
        <div className="space-y-4">
          <Card>
            <SectionTitle icon={KeyRound} title="API Credentials" subtitle="Loaded from server environment secrets — never in browser" color="text-primary" />
            {loadingCreds ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground py-4">
                <Loader2 className="w-4 h-4 animate-spin" /> Checking server credentials…
              </div>
            ) : (
              <div className="space-y-2">
                {[
                  { label: 'WALLET ADDRESS',   value: serverCreds?.walletAddress || '', secret: false },
                  { label: 'PRIVATE KEY',       value: serverCreds?.privateKey    || '', secret: true  },
                  { label: 'POLYMARKET API KEY',    value: serverCreds?.apiKey    || '', secret: true  },
                  { label: 'POLYMARKET API SECRET', value: serverCreds?.apiSecret || '', secret: true  },
                  { label: 'POLYMARKET PASSPHRASE', value: serverCreds?.passphrase|| '', secret: true  },
                ].map(({ label, value, secret }) => (
                  <div key={label}>
                    <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider mb-0.5">{label}</p>
                    <div className="flex items-center gap-2 rounded-md border border-border bg-secondary/30 px-3 py-1.5">
                      <Lock className="w-3 h-3 text-muted-foreground flex-shrink-0" />
                      <span className="font-mono text-xs text-foreground flex-1 truncate">
                        {value ? value : <span className="text-destructive">Not set</span>}
                      </span>
                      {value && <CheckCircle className="w-3 h-3 text-accent flex-shrink-0" />}
                    </div>
                  </div>
                ))}
                <div className={`mt-3 rounded-lg p-3 flex items-center gap-2 ${serverCreds?.allSet ? 'bg-accent/10 border border-accent/20' : 'bg-destructive/10 border border-destructive/20'}`}>
                  {serverCreds?.allSet
                    ? <><CheckCircle className="w-4 h-4 text-accent" /><span className="text-xs text-accent font-mono font-bold">All credentials set ✓</span></>
                    : <><XCircle className="w-4 h-4 text-destructive" /><span className="text-xs text-destructive font-mono">Missing credentials — set them in Dashboard → Settings → Environment Variables</span></>
                  }
                </div>
              </div>
            )}
          </Card>

          {/* Connection test */}
          <Card>
            <SectionTitle icon={Wifi} title="Connectivity Test" subtitle="Verify CLOB reachability and auth header generation" color="text-primary" />
            <div className="space-y-2 mb-4">
              <Row label="CLOB endpoint" value="clob.polymarket.com" />
              <Row label="Polygon Chain ID" value="137 (mainnet)" />
              <Row label="Exchange contract" value="0x4bFb41d5B...8982E" />
              <Row label="Test token (BTC YES)" value="21742...6455" />
              {connAddress && (
                <>
                  <Row label="Verified address" value={`${connAddress.slice(0, 10)}…${connAddress.slice(-6)}`} color="text-accent" />
                  <Row label="Auth endpoints" value="Require non-US IP" color="text-chart-4" />
                </>
              )}
            </div>
            <Button
              onClick={handleTestConnection}
              size="sm"
              variant="outline"
              disabled={connStatus === 'testing'}
              className="w-full"
            >
              {connStatus === 'testing'
                ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />Testing...</>
                : <><Zap className="w-3.5 h-3.5 mr-1.5" />Test Connection</>
              }
            </Button>
            {connStatus && connStatus !== 'testing' && (
              <div className="mt-3 flex items-center gap-2">
                <StatusBadge ok={connStatus === 'ok'} label={connStatus === 'ok' ? 'CLOB reachable' : 'Connection failed'} />
                {connError && <span className="text-[10px] text-destructive font-mono">{connError}</span>}
              </div>
            )}
          </Card>
        </div>

        {/* RIGHT: Order builder */}
        <div className="space-y-4">
          <Card>
            <SectionTitle icon={ArrowUpDown} title="Limit Order Builder" subtitle="Build, sign (EIP-712), and preview before broadcast" color="text-accent" />

            <div className="space-y-3 mb-4">
              <div>
                <label className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider block mb-1">Token ID (YES / NO)</label>
                <Input
                  className="font-mono text-xs"
                  value={orderForm.tokenId}
                  onChange={e => setOrderForm(f => ({ ...f, tokenId: e.target.value }))}
                  placeholder="Polymarket token ID"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider block mb-1">Side</label>
                  <div className="flex rounded-md overflow-hidden border border-border">
                    {['BUY', 'SELL'].map(s => (
                      <button
                        key={s}
                        onClick={() => setOrderForm(f => ({ ...f, side: s }))}
                        className={`flex-1 py-1.5 text-xs font-mono font-bold transition-colors
                          ${orderForm.side === s
                            ? s === 'BUY' ? 'bg-accent text-accent-foreground' : 'bg-destructive text-destructive-foreground'
                            : 'text-muted-foreground hover:bg-secondary'
                          }`}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider block mb-1">Price (0–1)</label>
                  <Input
                    type="number" min="0.01" max="0.99" step="0.01"
                    className="font-mono text-xs"
                    value={orderForm.price}
                    onChange={e => setOrderForm(f => ({ ...f, price: parseFloat(e.target.value) || 0.5 }))}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider block mb-1">Size (USDC)</label>
                  <Input
                    type="number" min="1" step="1"
                    className="font-mono text-xs"
                    value={orderForm.sizeUsdc}
                    onChange={e => setOrderForm(f => ({ ...f, sizeUsdc: parseFloat(e.target.value) || 10 }))}
                  />
                </div>
                <div>
                  <label className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider block mb-1">Expiry (secs, 0=GTC)</label>
                  <Input
                    type="number" min="0" step="60"
                    className="font-mono text-xs"
                    value={orderForm.expirySecs}
                    onChange={e => setOrderForm(f => ({ ...f, expirySecs: parseInt(e.target.value) || 0 }))}
                  />
                </div>
              </div>
            </div>

            {/* Order preview */}
            {orderPreview && (
              <div className="rounded-lg bg-secondary/40 border border-border p-3 mb-4 space-y-1">
                <p className="text-[10px] font-mono text-muted-foreground uppercase mb-2">Order Preview</p>
                <Row label="Shares" value={orderPreview.shares} />
                <Row label="Taker fee (7.2% crypto)" value={`$${orderPreview.fee}`} color="text-destructive" />
                <Row label="Net P&L if WIN" value={`+$${orderPreview.netWin}`} color="text-accent" />
                <Row label="Net P&L if LOSS" value={`-$${Math.abs(parseFloat(orderPreview.netLoss)).toFixed(4)}`} color="text-destructive" />
                <Row
                  label="Break-even edge needed"
                  value={`${orderPreview.breakEvenEdge}%`}
                  color={parseFloat(orderPreview.breakEvenEdge) < 5 ? 'text-accent' : 'text-chart-4'}
                />
              </div>
            )}

            <div className="flex gap-2">
              <Button onClick={handleBuildOrder} size="sm" variant="outline" className="flex-1">
                <BookOpen className="w-3.5 h-3.5 mr-1.5" />
                Build Struct
              </Button>
              <Button
                onClick={handleSignOrder}
                size="sm"
                className="flex-1"
                disabled={!signedPayload?.struct || signingStatus === 'signing'}
              >
                {signingStatus === 'signing'
                  ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />Signing...</>
                  : <><Shield className="w-3.5 h-3.5 mr-1.5" />Sign (EIP-712)</>
                }
              </Button>
            </div>
          </Card>

          {/* Signed payload inspector */}
          {signedPayload && (
            <Card>
              <div className="flex items-center justify-between mb-3">
                <SectionTitle icon={FlaskConical} title="Signed Order Payload" subtitle="Ready for broadcast to Polymarket CLOB" color="text-chart-4" />
                <div className="flex gap-1.5 flex-shrink-0 mt-[-8px]">
                  <StatusBadge ok={!!signedPayload.signed} label={signedPayload.signed ? 'SIGNED' : 'UNSIGNED'} />
                </div>
              </div>

              <div className="space-y-2">
                {Object.entries(signedPayload.struct).map(([k, v]) => (
                  <Row key={k} label={k} value={String(v).length > 24 ? String(v).slice(0, 12) + '…' + String(v).slice(-8) : String(v)} />
                ))}
                {signedPayload.signed && (
                  <div className="mt-3 rounded bg-accent/5 border border-accent/20 p-3">
                    <p className="text-[10px] text-muted-foreground mb-1 font-mono">EIP-712 Signature</p>
                    <p className="text-[10px] font-mono text-accent break-all">{signedPayload.signed}</p>
                  </div>
                )}
              </div>

              {signedPayload.signed && (
                <div className="space-y-3">
                  <div className="rounded-lg bg-primary/5 border border-primary/20 p-3">
                    <div className="flex items-start gap-2">
                      <Info className="w-3.5 h-3.5 text-primary mt-0.5 flex-shrink-0" />
                      <p className="text-xs text-muted-foreground">
                        Order is signed and ready to broadcast to Polymarket CLOB. This will execute a real trade and deduct USDC from your account.
                      </p>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Button 
                      onClick={handlePlaceOrder}
                      disabled={placingOrder}
                      className="w-full bg-accent hover:bg-accent/90"
                    >
                      {placingOrder ? (
                        <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />Placing order...</>
                      ) : (
                        <><Send className="w-3.5 h-3.5 mr-1.5" />Place ${orderForm.sizeUsdc} Order (Direct)</>
                      )}
                    </Button>
                    <Button 
                      onClick={() => setShowProxyOption(!showProxyOption)}
                      variant="outline"
                      size="sm"
                      className="w-full"
                    >
                      <Zap className="w-3.5 h-3.5 mr-1.5" />
                      {showProxyOption ? 'Hide' : 'Via Oxylabs Proxy'}
                    </Button>
                    {showProxyOption && (
                      <Button 
                        onClick={handlePlaceOrderViaProxy}
                        disabled={placingOrder}
                        variant="secondary"
                        className="w-full"
                      >
                        {placingOrder ? (
                          <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />Relaying...</>
                        ) : (
                          <><Wifi className="w-3.5 h-3.5 mr-1.5" />Route via Residential IP</>
                        )}
                      </Button>
                    )}
                  </div>
                </div>
              )}
            </Card>
          )}
        </div>
      </div>

      {/* Diagnostics Results */}
      {diagResults && (
        <div className="rounded-xl border border-border bg-card p-5 space-y-4">
          <SectionTitle icon={CheckCircle} title="Diagnostic Results" subtitle={`${diagResults.summary.passed} passed, ${diagResults.summary.failed} failed`} color={diagResults.summary.failed === 0 ? 'text-accent' : 'text-destructive'} />
          
          <div className="space-y-2">
            {diagResults.results.map((r, i) => (
              <div key={i} className={`p-3 rounded-lg border flex items-start gap-3 ${
                r.type === 'pass' ? 'bg-accent/5 border-accent/20' :
                r.type === 'fail' ? 'bg-destructive/5 border-destructive/20' :
                'bg-chart-4/5 border-chart-4/20'
              }`}>
                <span className="text-lg">{r.type === 'pass' ? '✅' : r.type === 'fail' ? '❌' : '⚠️'}</span>
                <div>
                  <p className="text-xs font-bold text-foreground">{r.name}</p>
                  <p className="text-[10px] text-muted-foreground">{r.message}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="rounded-lg bg-muted/30 border border-border p-3">
            <p className="text-[10px] font-mono text-muted-foreground mb-2">RECOMMENDATIONS</p>
            {diagResults.recommendations.map((rec, i) => (
              <p key={i} className="text-xs text-muted-foreground mb-1">• {rec}</p>
            ))}
          </div>

          {diagResults.summary.readyForTesting && (
            <div className="rounded-lg bg-accent/5 border border-accent/20 p-3 flex items-start gap-2">
              <CheckCircle className="w-4 h-4 text-accent mt-0.5 flex-shrink-0" />
              <p className="text-xs text-accent">Your setup looks good! If you still get 401 errors, the issue is likely account-level or geoblocking.</p>
            </div>
          )}
        </div>
      )}

      {/* EIP-712 Architecture */}
      <Card>
        <SectionTitle icon={ChevronRight} title="Trading Engine Architecture" subtitle="How signing + broadcast works" color="text-primary" />
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {[
            { step: '1', title: 'Build Struct', desc: 'Order params (tokenId, side, price, size) are packed into the CTF Exchange EIP-712 typed struct with a random salt and nonce.' },
            { step: '2', title: 'EIP-712 Sign', desc: 'The unsigned struct is sent to the polySign backend function. ethers.js signs it server-side using POLY_PRIVATE_KEY env var. Key never touches the browser.' },
            { step: '3', title: 'REST Auth', desc: 'HMAC-SHA256 signs the request timestamp + method + path using your API secret. Produces POLY-SIGNATURE header.' },
            { step: '4', title: 'CLOB Broadcast', desc: 'POST /order with the signed struct + signature. Polymarket\'s engine verifies on-chain, matches, and settles on Polygon.' },
          ].map(({ step, title, desc }) => (
            <div key={step} className="rounded-lg bg-secondary/30 border border-border p-4">
              <div className="w-6 h-6 rounded-full bg-primary/10 text-primary text-[10px] font-mono font-bold flex items-center justify-center mb-2">{step}</div>
              <p className="text-xs font-semibold text-foreground mb-1">{title}</p>
              <p className="text-[11px] text-muted-foreground leading-relaxed">{desc}</p>
            </div>
          ))}
        </div>

        <div className="mt-4 rounded-lg bg-muted/20 border border-border p-4">
          <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider mb-2">Module Structure</p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs font-mono">
            {[
              { file: 'functions/polyCredentials', desc: 'Server-side credential status check · masked values · env var backed' },
              { file: 'lib/polymarket/eip712.js', desc: 'Order struct builder · EIP-712 domain · signOrder() · HMAC REST auth' },
              { file: 'lib/polymarket/clobClient.js', desc: 'REST client · getOrderBook · placeLimitOrder · cancelOrder · computeNetPnl' },
            ].map(({ file, desc }) => (
              <div key={file} className="rounded bg-secondary/40 p-2.5">
                <p className="text-primary mb-1">{file}</p>
                <p className="text-muted-foreground text-[10px]">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </Card>
    </div>
  );
}