/**
 * Trading Engine Page
 *
 * UI for managing Polymarket CLOB credentials, testing connectivity,
 * and placing test limit orders. All signing is done client-side via
 * EIP-712 — private keys never leave the browser.
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  Shield, Zap, KeyRound, Eye, EyeOff, CheckCircle, XCircle,
  AlertTriangle, Wifi, WifiOff, ChevronRight, Loader2,
  FlaskConical, BookOpen, ArrowUpDown, Trash2, Info,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import {
  CREDENTIAL_FIELDS,
  saveCredentials,
  loadCredentials,
  clearCredentials,
  hasRequiredCredentials,
  maskSecret,
} from '@/lib/polymarket/credentials.js';
import {
  buildOrderStruct,
  buildRestAuthHeaders,
  SIDE,
} from '@/lib/polymarket/eip712.js';
import {
  getMidpointPrice,
  computeTakerFee,
  computeNetPnl,
} from '@/lib/polymarket/clobClient.js';

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
  const [creds, setCreds] = useState({});
  const [revealed, setRevealed] = useState({});
  const [saved, setSaved] = useState(false);
  const [connStatus, setConnStatus] = useState(null); // null | 'testing' | 'ok' | 'error'
  const [connError, setConnError] = useState('');
  const [livePrice, setLivePrice] = useState(null);
  const [orderPreview, setOrderPreview] = useState(null);
  const [orderForm, setOrderForm] = useState({
    tokenId: TEST_TOKEN,
    side: 'BUY',
    price: 0.52,
    sizeUsdc: 10,
    expirySecs: 300,
  });
  const [signedPayload, setSignedPayload] = useState(null);
  const [signingStatus, setSigningStatus] = useState(null);

  // Load from storage on mount
  useEffect(() => {
    const stored = loadCredentials();
    setCreds(stored);
    setSaved(hasRequiredCredentials(stored));
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

  const handleCredChange = (key, value) => {
    setCreds(prev => ({ ...prev, [key]: value }));
    setSaved(false);
  };

  const handleSave = () => {
    saveCredentials(creds);
    setSaved(true);
    toast.success('Credentials saved to browser storage');
  };

  const handleClear = () => {
    clearCredentials();
    setCreds({});
    setSaved(false);
    setConnStatus(null);
    toast.info('Credentials cleared');
  };

  const handleTestConnection = async () => {
    if (!hasRequiredCredentials(creds)) {
      toast.error('Fill in all credential fields first');
      return;
    }
    setConnStatus('testing');
    setConnError('');
    try {
      // Test 1: public CLOB reachability — fetch live BTC midpoint
      const price = await getMidpointPrice(TEST_TOKEN);
      setLivePrice(price);
      // Test 2: auth header construction (verifies secret format)
      await buildRestAuthHeaders('GET', '/auth/api-key', '', creds);
      setConnStatus('ok');
      toast.success(`CLOB reachable · BTC midpoint ${(price.price * 100).toFixed(1)}¢`);
    } catch (err) {
      setConnStatus('error');
      setConnError(err.message);
      toast.error(`Connection failed: ${err.message}`);
    }
  };

  const handleBuildOrder = useCallback(() => {
    if (!creds.walletAddress) {
      toast.error('Wallet address required to build order struct');
      return;
    }
    try {
      const struct = buildOrderStruct({
        maker:          creds.walletAddress,
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
      toast.success('Order struct built — ready to sign with private key');
    } catch (err) {
      toast.error(`Build failed: ${err.message}`);
    }
  }, [creds, orderForm]);

  const handleSignOrder = async () => {
    if (!signedPayload?.struct) return;
    if (!creds.privateKey) {
      toast.error('Private key required for EIP-712 signing');
      return;
    }
    setSigningStatus('signing');
    try {
      // Dynamic import ethers — must be available in the environment.
      // In production, install ethers: npm install ethers
      const { ethers } = await import('https://esm.sh/ethers@6.13.0');
      const wallet  = new ethers.Wallet(creds.privateKey);
      const { getEIP712Domain, getOrderTypes } = await import('@/lib/polymarket/eip712.js');
      const signature = await wallet.signTypedData(
        getEIP712Domain(),
        getOrderTypes(),
        signedPayload.struct,
      );
      setSignedPayload(prev => ({ ...prev, signed: signature }));
      setSigningStatus('done');
      toast.success('Order signed via EIP-712 ✓');
    } catch (err) {
      setSigningStatus('error');
      toast.error(`Signing failed: ${err.message}`);
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

      {/* Warning banner */}
      <div className="rounded-xl border border-chart-4/40 bg-chart-4/5 p-4 flex items-start gap-3">
        <AlertTriangle className="w-4 h-4 text-chart-4 mt-0.5 flex-shrink-0" />
        <div className="text-xs text-muted-foreground space-y-1">
          <p><strong className="text-chart-4">Private keys are stored in your browser only.</strong> They are never sent to any server. Use a dedicated trading wallet — never your main wallet.</p>
          <p>Live order broadcast requires a funded Polygon wallet with USDC. Placing orders on a real market will spend real money.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* LEFT: Credentials */}
        <div className="space-y-4">
          <Card>
            <SectionTitle icon={KeyRound} title="API Credentials" subtitle="Stored in browser localStorage — never transmitted" color="text-primary" />
            <div className="space-y-3">
              {CREDENTIAL_FIELDS.map(field => (
                <div key={field.key}>
                  <label className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider block mb-1">
                    {field.label}
                  </label>
                  <div className="relative">
                    <Input
                      type={field.sensitive && !revealed[field.key] ? 'password' : 'text'}
                      placeholder={field.placeholder}
                      value={creds[field.key] || ''}
                      onChange={e => handleCredChange(field.key, e.target.value)}
                      className="font-mono text-xs pr-9"
                    />
                    {field.sensitive && (
                      <button
                        type="button"
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                        onClick={() => setRevealed(r => ({ ...r, [field.key]: !r[field.key] }))}
                      >
                        {revealed[field.key] ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                      </button>
                    )}
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-0.5">{field.description}</p>
                </div>
              ))}
            </div>
            <div className="flex gap-2 mt-5">
              <Button onClick={handleSave} size="sm" className="flex-1">
                <Shield className="w-3.5 h-3.5 mr-1.5" />
                Save Credentials
              </Button>
              <Button onClick={handleClear} size="sm" variant="outline" className="text-destructive border-destructive/30 hover:bg-destructive/10">
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            </div>
            {saved && (
              <p className="text-[10px] font-mono text-accent mt-2 flex items-center gap-1">
                <CheckCircle className="w-3 h-3" /> Credentials saved
              </p>
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
              {livePrice && (
                <>
                  <Row label="BTC market bid" value={`${(livePrice.bid * 100).toFixed(1)}¢`} color="text-accent" />
                  <Row label="BTC market ask" value={`${(livePrice.ask * 100).toFixed(1)}¢`} color="text-destructive" />
                  <Row label="BTC midpoint" value={`${(livePrice.price * 100).toFixed(1)}¢`} color="text-primary" />
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
                <div className="rounded-lg bg-primary/5 border border-primary/20 p-3 mt-4">
                  <div className="flex items-start gap-2">
                    <Info className="w-3.5 h-3.5 text-primary mt-0.5 flex-shrink-0" />
                    <p className="text-xs text-muted-foreground">
                      Order is signed and ready. To broadcast, call <code className="text-primary font-mono text-[10px]">placeLimitOrder()</code> from{' '}
                      <code className="text-primary font-mono text-[10px]">lib/polymarket/clobClient.js</code> — this will submit to the live CLOB and spend real USDC.
                    </p>
                  </div>
                </div>
              )}
            </Card>
          )}
        </div>
      </div>

      {/* EIP-712 Architecture */}
      <Card>
        <SectionTitle icon={ChevronRight} title="Trading Engine Architecture" subtitle="How signing + broadcast works" color="text-primary" />
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {[
            { step: '1', title: 'Build Struct', desc: 'Order params (tokenId, side, price, size) are packed into the CTF Exchange EIP-712 typed struct with a random salt and nonce.' },
            { step: '2', title: 'EIP-712 Sign', desc: 'ethers.js signs the typed data hash with your private key locally. The key never leaves the browser. Signature: 65-byte ECDSA (r,s,v).' },
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
              { file: 'lib/polymarket/credentials.js', desc: 'LocalStorage credential manager · mask/reveal · validation' },
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