/**
 * Client-Side Signer — EIP-712 signing directly in the browser
 * 
 * Uses ethers.js from CDN to sign orders with your private key.
 * Private key is entered locally, never sent to any server.
 * Signs EIP-712 orders and broadcasts them to Polymarket CLOB.
 */

import React, { useState, useEffect } from 'react';
import {
  Shield, Zap, Lock, CheckCircle, XCircle, Loader2,
  AlertTriangle, Send, Eye, EyeOff, Copy, Trash2,
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

// Load ethers.js from CDN at runtime
let ethers = null;
const loadEthers = async () => {
  if (ethers) return ethers;
  const script = document.createElement('script');
  script.src = 'https://cdn.ethers.io/lib/ethers-5.7.umd.min.js';
  return new Promise((resolve, reject) => {
    script.onload = () => {
      ethers = window.ethers;
      resolve(ethers);
    };
    script.onerror = reject;
    document.head.appendChild(script);
  });
};

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

export default function ClientSideSigner() {
  const [ethersLoaded, setEthersLoaded] = useState(false);
  const [loadingEthers, setLoadingEthers] = useState(false);
  const [privKeyInput, setPrivKeyInput] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [wallet, setWallet] = useState(null);
  const [apiCreds, setApiCreds] = useState(null);

  const [orderForm, setOrderForm] = useState({
    tokenId: '21742633143463906290569050155826241533067272736897614950488156847949938836455',
    side: 'BUY',
    price: 0.52,
    sizeUsdc: 10,
    expirySecs: 300,
  });

  const [orderStruct, setOrderStruct] = useState(null);
  const [signedOrder, setSignedOrder] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [txStatus, setTxStatus] = useState(null);

  // Load ethers on mount
  useEffect(() => {
    setLoadingEthers(true);
    loadEthers()
      .then(() => setEthersLoaded(true))
      .catch(err => {
        toast.error(`Failed to load ethers.js: ${err.message}`);
      })
      .finally(() => setLoadingEthers(false));
  }, []);

  // Fetch API creds from server (for REST auth, not signing)
  useEffect(() => {
    base44.functions
      .invoke('polyCredentials', { action: 'check' })
      .then(res => setApiCreds(res.data))
      .catch(() => {});
  }, []);

  const handleImportKey = async () => {
    if (!privKeyInput.trim()) {
      toast.error('Enter your private key');
      return;
    }
    if (!ethers) {
      toast.error('ethers.js not loaded');
      return;
    }
    try {
      const w = new ethers.Wallet(privKeyInput.trim());
      setWallet(w);
      toast.success(`Wallet imported: ${w.address.slice(0, 10)}…`);
    } catch (err) {
      toast.error(`Invalid private key: ${err.message}`);
    }
  };

  const handleClearKey = () => {
    setPrivKeyInput('');
    setWallet(null);
    setOrderStruct(null);
    setSignedOrder(null);
    toast.info('Wallet cleared');
  };

  const handleBuildOrder = () => {
    if (!wallet) {
      toast.error('Import wallet first');
      return;
    }
    try {
      const struct = buildOrderStruct({
        maker: wallet.address,
        tokenId: orderForm.tokenId,
        side: orderForm.side === 'BUY' ? SIDE.BUY : SIDE.SELL,
        price: Number(orderForm.price),
        sizeUsdc: Number(orderForm.sizeUsdc),
        expirationSecs: Number(orderForm.expirySecs),
        nonce: Date.now(),
        feeRateBps: 720,
      });
      setOrderStruct(struct);
      setSignedOrder(null);
      toast.success('Order struct built');
    } catch (err) {
      toast.error(`Build failed: ${err.message}`);
    }
  };

  const handleSignOrder = async () => {
    if (!orderStruct || !wallet || !ethers) {
      toast.error('Build order first');
      return;
    }
    try {
      const domain = {
        name: 'Polymarket CTF Exchange',
        version: '1',
        chainId: 137,
        verifyingContract: '0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E',
      };
      const types = {
        Order: [
          { name: 'salt', type: 'uint256' },
          { name: 'maker', type: 'address' },
          { name: 'signer', type: 'address' },
          { name: 'taker', type: 'address' },
          { name: 'tokenId', type: 'uint256' },
          { name: 'makerAmount', type: 'uint256' },
          { name: 'takerAmount', type: 'uint256' },
          { name: 'expiration', type: 'uint256' },
          { name: 'nonce', type: 'uint256' },
          { name: 'feeRateBps', type: 'uint256' },
          { name: 'side', type: 'uint8' },
          { name: 'signatureType', type: 'uint8' },
        ],
      };
      const sig = await wallet._signTypedData(domain, types, orderStruct);
      setSignedOrder({ ...orderStruct, signature: sig });
      toast.success('Order signed with EIP-712 ✓');
    } catch (err) {
      toast.error(`Signing failed: ${err.message}`);
    }
  };

  const handleBroadcast = async () => {
    if (!signedOrder || !apiCreds) {
      toast.error('Sign order and load API credentials first');
      return;
    }
    setSubmitting(true);
    setTxStatus(null);
    try {
      // Build REST auth headers
      const headers = await buildRestAuthHeaders(
        'POST',
        '/orders',
        JSON.stringify([signedOrder]),
        {
          apiKey: apiCreds.apiKey,
          apiSecret: apiCreds.apiSecret,
          apiPassphrase: apiCreds.passphrase,
        }
      );

      // Submit to Polymarket CLOB (requires non-US IP or proxy)
      const res = await fetch('https://clob.polymarket.com/orders', {
        method: 'POST',
        headers,
        body: JSON.stringify([signedOrder]),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(data?.error || `HTTP ${res.status}`);
      }

      setTxStatus('success');
      toast.success('Order broadcast to Polymarket CLOB ✓');

      // Log to database
      await base44.functions.invoke('logLiveTradeExecution', {
        order: signedOrder,
        txHash: data?.txHash || 'pending',
      });
    } catch (err) {
      setTxStatus('error');
      toast.error(`Broadcast failed: ${err.message}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="p-4 md:p-6 max-w-[1400px] mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-foreground">Client-Side Signer</h1>
        <p className="text-xs text-muted-foreground mt-1 font-mono">
          EIP-712 signing in browser · private key never sent to server · live order broadcast
        </p>
      </div>

      {/* Security banner */}
      <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 flex items-start gap-3">
        <AlertTriangle className="w-4 h-4 text-destructive mt-0.5 flex-shrink-0" />
        <div className="text-xs text-muted-foreground space-y-1">
          <p>
            <strong className="text-destructive">⚠️ WARNING: Private key is NOT encrypted.</strong> This approach stores your key locally in the browser — only use on a trusted device.
          </p>
          <p>
            For production, use a hardware wallet (Ledger, Trezor) or a secure key management system like Web3Modal / WalletConnect.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* LEFT: Key import */}
        <div className="space-y-4">
          <Card>
            <SectionTitle icon={Lock} title="Private Key Import" subtitle="Loaded only in browser memory, never sent anywhere" color="text-destructive" />
            {!ethersLoaded ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground py-4">
                {loadingEthers && <Loader2 className="w-4 h-4 animate-spin" />}
                Loading ethers.js…
              </div>
            ) : (
              <div className="space-y-3">
                <div>
                  <label className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider block mb-2">
                    Your Private Key (0x…)
                  </label>
                  <div className="flex gap-2 items-center">
                    <div className="relative flex-1">
                      <input
                        type={showKey ? 'text' : 'password'}
                        className="w-full rounded-lg border border-border bg-secondary/30 px-3 py-2 text-xs font-mono text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                        placeholder="0x..."
                        value={privKeyInput}
                        onChange={e => setPrivKeyInput(e.target.value)}
                        disabled={!!wallet}
                      />
                      <button
                        onClick={() => setShowKey(!showKey)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                      >
                        {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>
                </div>

                {wallet ? (
                  <div className="rounded-lg bg-accent/10 border border-accent/20 p-3 space-y-2">
                    <div className="flex items-center gap-2">
                      <CheckCircle className="w-4 h-4 text-accent" />
                      <span className="text-xs font-mono text-accent font-bold">Wallet loaded</span>
                    </div>
                    <div className="text-xs font-mono text-foreground break-all">{wallet.address}</div>
                    <Button
                      onClick={handleClearKey}
                      size="sm"
                      variant="outline"
                      className="w-full text-xs"
                    >
                      <Trash2 className="w-3 h-3 mr-1.5" />
                      Clear Wallet
                    </Button>
                  </div>
                ) : (
                  <Button
                    onClick={handleImportKey}
                    size="sm"
                    className="w-full"
                    disabled={!privKeyInput.trim()}
                  >
                    <Shield className="w-3.5 h-3.5 mr-1.5" />
                    Import Wallet
                  </Button>
                )}
              </div>
            )}
          </Card>

          {/* Order form */}
          {wallet && (
            <Card>
              <SectionTitle icon={Zap} title="Order Parameters" subtitle="Configure limit order details" color="text-primary" />
              <div className="space-y-3">
                <div>
                  <label className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider block mb-1">Token ID</label>
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
                    <label className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider block mb-1">Price</label>
                    <Input
                      type="number"
                      min="0.01"
                      max="0.99"
                      step="0.01"
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
                      type="number"
                      min="1"
                      step="1"
                      className="font-mono text-xs"
                      value={orderForm.sizeUsdc}
                      onChange={e => setOrderForm(f => ({ ...f, sizeUsdc: parseFloat(e.target.value) || 10 }))}
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider block mb-1">Expiry (secs)</label>
                    <Input
                      type="number"
                      min="0"
                      step="60"
                      className="font-mono text-xs"
                      value={orderForm.expirySecs}
                      onChange={e => setOrderForm(f => ({ ...f, expirySecs: parseInt(e.target.value) || 0 }))}
                    />
                  </div>
                </div>
              </div>
            </Card>
          )}
        </div>

        {/* RIGHT: Order building & signing */}
        <div className="space-y-4">
          {wallet && (
            <>
              <Card>
                <SectionTitle icon={Shield} title="Build & Sign Order" subtitle="Client-side EIP-712 signing" color="text-accent" />
                <div className="flex gap-2">
                  <Button onClick={handleBuildOrder} size="sm" variant="outline" className="flex-1">
                    Build Struct
                  </Button>
                  <Button
                    onClick={handleSignOrder}
                    size="sm"
                    className="flex-1"
                    disabled={!orderStruct}
                  >
                    {signedOrder ? '✓ Signed' : 'Sign Order'}
                  </Button>
                </div>
              </Card>

              {orderStruct && (
                <Card>
                  <SectionTitle icon={Zap} title="Order Struct" subtitle="Built, ready to sign" color="text-primary" />
                  <div className="space-y-1 max-h-32 overflow-y-auto">
                    {Object.entries(orderStruct).map(([k, v]) => (
                      <Row
                        key={k}
                        label={k}
                        value={String(v).length > 20 ? String(v).slice(0, 10) + '…' : String(v)}
                      />
                    ))}
                  </div>
                </Card>
              )}

              {signedOrder && (
                <Card>
                  <SectionTitle icon={CheckCircle} title="Signed Order" subtitle="Ready for broadcast" color="text-accent" />
                  <div className="rounded-lg bg-accent/5 border border-accent/20 p-3 mb-4">
                    <p className="text-[10px] font-mono text-muted-foreground mb-2">Signature</p>
                    <p className="text-[10px] font-mono text-accent break-all">{signedOrder.signature}</p>
                  </div>
                  <Button
                    onClick={handleBroadcast}
                    disabled={submitting}
                    className="w-full"
                    variant={txStatus === 'success' ? 'outline' : txStatus === 'error' ? 'destructive' : 'default'}
                  >
                    {submitting && <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />}
                    {txStatus === 'success'
                      ? '✓ Broadcast successful'
                      : txStatus === 'error'
                      ? '✗ Broadcast failed'
                      : <><Send className="w-3.5 h-3.5 mr-1.5" />Broadcast to CLOB</>}
                  </Button>
                </Card>
              )}
            </>
          )}

          {!wallet && (
            <Card>
              <p className="text-xs text-muted-foreground text-center py-8">
                Import your wallet to build and sign orders
              </p>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}