import React from 'react';
import { TrendingUp, TrendingDown } from 'lucide-react';

export default function StatCard({ label, value, change, changeLabel, icon: Icon, highlight }) {
  const isPositive = change >= 0;

  return (
    <div className={`relative overflow-hidden rounded-xl border border-border bg-card p-5 transition-all duration-300 hover:border-primary/30 ${
      highlight ? 'border-primary/20' : ''
    }`}>
      {highlight && (
        <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-primary to-transparent" />
      )}
      <div className="flex items-start justify-between mb-3">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{label}</span>
        {Icon && (
          <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
            <Icon className="w-4 h-4 text-primary" />
          </div>
        )}
      </div>
      <p className="text-2xl font-bold font-mono tracking-tight text-foreground">{value}</p>
      {change !== undefined && (
        <div className="flex items-center gap-1.5 mt-2">
          {isPositive ? (
            <TrendingUp className="w-3.5 h-3.5 text-accent" />
          ) : (
            <TrendingDown className="w-3.5 h-3.5 text-destructive" />
          )}
          <span className={`text-xs font-mono font-medium ${isPositive ? 'text-accent' : 'text-destructive'}`}>
            {isPositive ? '+' : ''}{change}%
          </span>
          {changeLabel && <span className="text-xs text-muted-foreground">{changeLabel}</span>}
        </div>
      )}
    </div>
  );
}