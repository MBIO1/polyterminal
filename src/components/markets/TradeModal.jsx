import React, { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ArrowUpRight, ArrowDownRight, Zap } from 'lucide-react';

export default function TradeModal({ market, initialSide, open, onClose, onSubmit }) {
  const [side, setSide] = useState(initialSide || 'yes');
  const [action, setAction] = useState('buy');
  const [amount, setAmount] = useState(10);
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!market) return null;

  const price = side === 'yes' ? market.yes_price : market.no_price;
  const shares = amount / price;
  const potentialPayout = shares * 1;
  const potentialProfit = potentialPayout - amount;

  const handleSubmit = async () => {
    setIsSubmitting(true);
    await onSubmit({
      market,
      side,
      action,
      shares: Math.floor(shares),
      price,
      total: amount,
    });
    setIsSubmitting(false);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="bg-card border-border max-w-md">
        <DialogHeader>
          <DialogTitle className="text-foreground text-base pr-6">{market.title}</DialogTitle>
        </DialogHeader>

        {/* Side selection */}
        <Tabs value={side} onValueChange={setSide} className="w-full">
          <TabsList className="w-full bg-secondary">
            <TabsTrigger value="yes" className="flex-1 font-mono data-[state=active]:bg-accent/20 data-[state=active]:text-accent">
              YES {Math.round((market.yes_price || 0) * 100)}¢
            </TabsTrigger>
            <TabsTrigger value="no" className="flex-1 font-mono data-[state=active]:bg-destructive/20 data-[state=active]:text-destructive">
              NO {Math.round((market.no_price || 0) * 100)}¢
            </TabsTrigger>
          </TabsList>
        </Tabs>

        {/* Action */}
        <div className="flex gap-2">
          <Button
            variant={action === 'buy' ? 'default' : 'outline'}
            size="sm"
            className={action === 'buy' ? 'bg-accent text-accent-foreground' : 'border-border'}
            onClick={() => setAction('buy')}
          >
            <ArrowUpRight className="w-3.5 h-3.5 mr-1" /> Buy
          </Button>
          <Button
            variant={action === 'sell' ? 'default' : 'outline'}
            size="sm"
            className={action === 'sell' ? 'bg-destructive text-destructive-foreground' : 'border-border'}
            onClick={() => setAction('sell')}
          >
            <ArrowDownRight className="w-3.5 h-3.5 mr-1" /> Sell
          </Button>
        </div>

        {/* Amount */}
        <div className="space-y-3">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Amount ($)</label>
          <Input
            type="number"
            value={amount}
            onChange={(e) => setAmount(Number(e.target.value))}
            className="font-mono text-lg bg-secondary border-border"
            min={1}
          />
          <Slider
            value={[amount]}
            onValueChange={([v]) => setAmount(v)}
            max={1000}
            min={1}
            step={1}
            className="py-2"
          />
          <div className="flex justify-between text-xs text-muted-foreground font-mono">
            <span>$1</span>
            <span>$1,000</span>
          </div>
        </div>

        {/* Summary */}
        <div className="rounded-lg bg-secondary/50 border border-border p-4 space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Shares</span>
            <span className="font-mono text-foreground">{Math.floor(shares)}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Avg Price</span>
            <span className="font-mono text-foreground">{Math.round(price * 100)}¢</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Cost</span>
            <span className="font-mono text-foreground">${amount.toFixed(2)}</span>
          </div>
          <div className="border-t border-border pt-2 flex justify-between text-sm">
            <span className="text-muted-foreground">Potential Profit</span>
            <span className="font-mono font-bold text-accent">+${potentialProfit.toFixed(2)}</span>
          </div>
        </div>

        <Button
          onClick={handleSubmit}
          disabled={isSubmitting || amount <= 0}
          className={`w-full font-mono ${
            action === 'buy'
              ? 'bg-accent hover:bg-accent/90 text-accent-foreground'
              : 'bg-destructive hover:bg-destructive/90 text-destructive-foreground'
          }`}
        >
          <Zap className="w-4 h-4 mr-2" />
          {isSubmitting ? 'Processing...' : `${action.toUpperCase()} ${side.toUpperCase()} — $${amount.toFixed(2)}`}
        </Button>
      </DialogContent>
    </Dialog>
  );
}