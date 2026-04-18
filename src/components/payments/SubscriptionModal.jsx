import React, { useState, useEffect } from 'react';
import { X, CreditCard, Loader2, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';

const PLANS = [
  { name: '$50/month', priceId: 'price_1TNbkP2RM6TcOLnTtbgxhIxw', amount: '$50', usdc: '~50 USDC' },
  { name: '$100/month', priceId: 'price_1TNbkP2RM6TcOLnThEyp5B5o', amount: '$100', usdc: '~100 USDC', popular: true },
  { name: '$250/month', priceId: 'price_1TNbkP2RM6TcOLnThEtm94Ok', amount: '$250', usdc: '~250 USDC' },
];

export default function SubscriptionModal({ open, onClose }) {
  const [loading, setLoading] = useState(false);
  const [inIframe, setInIframe] = useState(false);

  useEffect(() => {
    setInIframe(window.self !== window.top);
  }, []);

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

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-card rounded-xl border border-border w-full max-w-2xl mx-4 p-6 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-2xl font-bold text-foreground">Fund Your Account</h2>
            <p className="text-sm text-muted-foreground mt-1">Choose a monthly subscription to deposit USDC</p>
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

        {/* Plans Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          {PLANS.map((plan) => (
            <div
              key={plan.priceId}
              className={`rounded-lg border p-6 text-center transition-all ${
                plan.popular
                  ? 'border-primary bg-primary/5 ring-1 ring-primary'
                  : 'border-border bg-secondary/30 hover:border-primary/50'
              }`}
            >
              {plan.popular && (
                <span className="inline-block px-2 py-1 rounded text-[10px] font-bold bg-primary text-primary-foreground mb-3">
                  MOST POPULAR
                </span>
              )}
              <div className="text-3xl font-bold text-foreground mb-1">{plan.amount}</div>
              <div className="text-xs text-muted-foreground mb-4">/month</div>
              <div className="text-sm font-mono text-accent mb-4">{plan.usdc}</div>
              <Button
                onClick={() => handleSubscribe(plan.priceId)}
                disabled={loading || inIframe}
                className="w-full"
                variant={plan.popular ? 'default' : 'outline'}
              >
                {loading ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Processing...</>
                ) : (
                  <><CreditCard className="w-4 h-4 mr-2" />Subscribe</>
                )}
              </Button>
            </div>
          ))}
        </div>

        {/* Info */}
        <div className="rounded-lg bg-muted/30 border border-border p-4 space-y-2">
          <div className="text-xs text-muted-foreground">💳 Secure Stripe payments · Your card info is never stored on our servers</div>
          <div className="text-xs text-muted-foreground">🔄 Automatic monthly deposits to your trading account</div>
          <div className="text-xs text-muted-foreground">⚙️ Cancel anytime from your account settings</div>
        </div>
      </div>
    </div>
  );
}