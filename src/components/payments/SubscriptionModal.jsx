import React, { useState, useEffect } from 'react';
import { X, CreditCard, Loader2, AlertCircle, TrendingUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';

const PLANS = [
  { name: '$50/month', priceId: 'price_1TNbkP2RM6TcOLnTtbgxhIxw', amount: 50, usdc: 50 },
  { name: '$100/month', priceId: 'price_1TNbkP2RM6TcOLnThEyp5B5o', amount: 100, usdc: 100, popular: true },
  { name: '$250/month', priceId: 'price_1TNbkP2RM6TcOLnThEtm94Ok', amount: 250, usdc: 250 },
];

const DAILY_LIMIT = 1000;

export default function SubscriptionModal({ open, onClose }) {
  const [loading, setLoading] = useState(false);
  const [inIframe, setInIframe] = useState(false);
  const [mode, setMode] = useState('plans'); // 'plans' or 'custom'
  const [customAmount, setCustomAmount] = useState('');
  const [dailyLimit, setDailyLimit] = useState({
    remaining: DAILY_LIMIT,
    todayTotal: 0,
    loading: true,
  });

  useEffect(() => {
    setInIframe(window.self !== window.top);
  }, []);

  // Load daily limit on mount
  useEffect(() => {
    if (open) {
      setDailyLimit({ remaining: DAILY_LIMIT, todayTotal: 0, loading: true });
      base44.functions
        .invoke('checkDailyLimit', {})
        .then(res => {
          setDailyLimit({
            remaining: res.data.remaining,
            todayTotal: res.data.todayTotal,
            loading: false,
          });
        })
        .catch(() => {
          setDailyLimit({ remaining: DAILY_LIMIT, todayTotal: 0, loading: false });
        });
    }
  }, [open]);

  const handleSubscribe = async (priceId) => {
    if (inIframe) {
      toast.error('Checkout only works from the published app, not in preview');
      return;
    }

    setLoading(true);
    try {
      const res = await base44.functions.invoke('stripeCheckout', { priceId });
      if (res.data?.sessionUrl) {
        window.location.href = res.data.sessionUrl;
      } else {
        throw new Error('No checkout URL returned');
      }
    } catch (err) {
      toast.error(`Payment failed: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleCustomDeposit = async () => {
    const amount = parseFloat(customAmount);
    if (!amount || amount <= 0) {
      toast.error('Enter a valid amount');
      return;
    }
    if (amount > dailyLimit.remaining) {
      toast.error(`Exceeds daily limit. Remaining: $${dailyLimit.remaining.toFixed(2)}`);
      return;
    }

    if (inIframe) {
      toast.error('Checkout only works from the published app, not in preview');
      return;
    }

    setLoading(true);
    try {
      const res = await base44.functions.invoke('stripeCheckout', {
        amount: Math.round(amount * 100),
        isCustom: true,
      });
      if (res.data?.sessionUrl) {
        window.location.href = res.data.sessionUrl;
      } else {
        throw new Error('No checkout URL returned');
      }
    } catch (err) {
      toast.error(`Payment failed: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('payment') === 'success') {
      toast.success('✅ Payment received! USDC deposited to your wallet address.');
      window.history.replaceState({}, document.title, window.location.pathname);
      setMode('plans');
      setCustomAmount('');
    }
  }, []);

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-card rounded-xl border border-border w-full max-w-2xl mx-4 p-6 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-2xl font-bold text-foreground">Add Trading Investment</h2>
            <p className="text-sm text-muted-foreground mt-1">Deposit USDC to your wallet for arbitrage trading</p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="w-5 h-5" />
          </button>
        </div>

        {inIframe && (
          <div className="mb-6 p-3 rounded-lg bg-chart-4/10 border border-chart-4/30 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-chart-4 mt-0.5 flex-shrink-0" />
            <p className="text-xs text-chart-4">Checkout works only from the published app. Publish your app to complete payment.</p>
          </div>
        )}

        {/* Daily Limit Banner */}
        <div className={`mb-6 p-4 rounded-lg border ${
          dailyLimit.remaining <= 0
            ? 'bg-destructive/10 border-destructive/30'
            : dailyLimit.remaining < 100
            ? 'bg-chart-4/10 border-chart-4/30'
            : 'bg-accent/10 border-accent/30'
        }`}>
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-semibold text-foreground flex items-center gap-2">
              <TrendingUp className="w-4 h-4" />
              Daily Deposit Limit
            </p>
            <p className={`text-sm font-mono font-bold ${
              dailyLimit.remaining <= 0 ? 'text-destructive' : dailyLimit.remaining < 100 ? 'text-chart-4' : 'text-accent'
            }`}>
              ${dailyLimit.remaining.toFixed(2)} remaining
            </p>
          </div>
          <div className="w-full bg-secondary/50 rounded-full h-2">
            <div
              className={`h-2 rounded-full transition-all ${
                dailyLimit.remaining <= 0 ? 'bg-destructive' : dailyLimit.remaining < 100 ? 'bg-chart-4' : 'bg-accent'
              }`}
              style={{ width: `${Math.min(100, (dailyLimit.remaining / DAILY_LIMIT) * 100)}%` }}
            />
          </div>
          <p className="text-xs text-muted-foreground mt-2">Today's deposits: ${dailyLimit.todayTotal.toFixed(2)} / $1,000 max</p>
        </div>

        {/* Mode Toggle */}
        <div className="flex gap-2 mb-6">
          <button
            onClick={() => setMode('plans')}
            className={`flex-1 py-2 px-3 rounded-lg font-semibold text-sm transition-all ${
              mode === 'plans'
                ? 'bg-primary text-primary-foreground'
                : 'bg-secondary/40 text-muted-foreground hover:bg-secondary/60'
            }`}
          >
            Quick Plans
          </button>
          <button
            onClick={() => setMode('custom')}
            className={`flex-1 py-2 px-3 rounded-lg font-semibold text-sm transition-all ${
              mode === 'custom'
                ? 'bg-primary text-primary-foreground'
                : 'bg-secondary/40 text-muted-foreground hover:bg-secondary/60'
            }`}
            disabled={dailyLimit.remaining <= 0}
          >
            Custom Amount
          </button>
        </div>

        {/* Plans Mode */}
        {mode === 'plans' && (
          <div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
              {PLANS.map((plan) => (
                <div
                  key={plan.priceId}
                  className={`rounded-lg border p-6 text-center transition-all cursor-pointer ${
                    plan.popular
                      ? 'border-primary bg-primary/5 ring-1 ring-primary'
                      : 'border-border bg-secondary/30 hover:border-primary/50'
                  } ${plan.amount > dailyLimit.remaining ? 'opacity-50 pointer-events-none' : ''}`}
                >
                  {plan.popular && (
                    <span className="inline-block px-2 py-1 rounded text-[10px] font-bold bg-primary text-primary-foreground mb-3">
                      POPULAR
                    </span>
                  )}
                  <div className="text-3xl font-bold text-foreground mb-1">${plan.amount}</div>
                  <div className="text-xs text-muted-foreground mb-4">one time</div>
                  <div className="text-sm font-mono text-accent mb-4">{plan.usdc} USDC</div>
                  <Button
                    onClick={() => handleSubscribe(plan.priceId)}
                    disabled={loading || inIframe || plan.amount > dailyLimit.remaining}
                    className="w-full"
                    variant={plan.popular ? 'default' : 'outline'}
                  >
                    {loading ? (
                      <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Processing...</>
                    ) : (
                      <><CreditCard className="w-4 h-4 mr-2" />Deposit</>
                    )}
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Custom Amount Mode */}
        {mode === 'custom' && (
          <div className="mb-6 space-y-4">
            <div>
              <label className="text-sm font-semibold text-foreground mb-2 block">Deposit Amount (USD)</label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <span className="absolute left-3 top-3 text-muted-foreground">$</span>
                  <Input
                    type="number"
                    min="1"
                    max={dailyLimit.remaining}
                    step="10"
                    value={customAmount}
                    onChange={e => setCustomAmount(e.target.value)}
                    placeholder={`Max: $${dailyLimit.remaining.toFixed(2)}`}
                    className="pl-7 font-mono"
                  />
                </div>
              </div>
              {customAmount && (
                <p className="text-xs text-accent font-mono mt-2">
                  ≈ {parseFloat(customAmount).toFixed(2)} USDC will be deposited
                </p>
              )}
            </div>

            <Button
              onClick={handleCustomDeposit}
              disabled={loading || inIframe || !customAmount || parseFloat(customAmount) > dailyLimit.remaining}
              className="w-full bg-accent hover:bg-accent/90"
            >
              {loading ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Processing...</>
              ) : (
                <><CreditCard className="w-4 h-4 mr-2" />Deposit ${customAmount || '0'}</>
              )}
            </Button>
          </div>
        )}

        {/* Info */}
        <div className="rounded-lg bg-muted/30 border border-border p-4 space-y-2">
          <div className="text-xs text-muted-foreground">💳 Secure Stripe payments · Card info never stored on our servers</div>
          <div className="text-xs text-muted-foreground">💰 USDC deposited directly to your main dashboard wallet address</div>
          <div className="text-xs text-muted-foreground">⏱️ Daily limit: $1,000 USD (Stripe policy)</div>
        </div>
      </div>
    </div>
  );
}