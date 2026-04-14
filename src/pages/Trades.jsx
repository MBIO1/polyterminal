import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { format } from 'date-fns';
import { ArrowUpRight, ArrowDownRight, Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

export default function Trades() {
  const [search, setSearch] = useState('');

  const { data: trades = [], isLoading } = useQuery({
    queryKey: ['trades'],
    queryFn: () => base44.entities.Trade.list('-created_date'),
  });

  const filtered = trades.filter(t =>
    t.market_title?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="p-4 md:p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Trade History</h1>
          <p className="text-sm text-muted-foreground mt-1">{trades.length} trades executed</p>
        </div>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          placeholder="Search trades..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-10 bg-secondary border-border"
        />
      </div>

      {/* Mobile cards */}
      <div className="lg:hidden space-y-3">
        {isLoading ? (
          Array(5).fill(0).map((_, i) => (
            <div key={i} className="h-24 rounded-xl bg-card border border-border animate-pulse" />
          ))
        ) : filtered.length > 0 ? (
          filtered.map((trade) => (
            <div key={trade.id} className="rounded-xl border border-border bg-card p-4">
              <div className="flex items-start justify-between mb-2">
                <p className="text-sm font-medium text-foreground truncate pr-3">{trade.market_title}</p>
                <div className={`flex items-center gap-1 shrink-0 ${trade.action === 'buy' ? 'text-accent' : 'text-destructive'}`}>
                  {trade.action === 'buy' ? <ArrowUpRight className="w-3.5 h-3.5" /> : <ArrowDownRight className="w-3.5 h-3.5" />}
                  <span className="text-sm font-mono font-bold">${(trade.total || 0).toFixed(2)}</span>
                </div>
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Badge variant="outline" className={`text-[10px] font-mono ${
                  trade.side === 'yes' ? 'border-accent/30 text-accent' : 'border-destructive/30 text-destructive'
                }`}>
                  {trade.side?.toUpperCase()}
                </Badge>
                <span>{trade.shares} shares</span>
                <span>@ {Math.round((trade.price || 0) * 100)}¢</span>
                {trade.created_date && <span>• {format(new Date(trade.created_date), 'MMM d, HH:mm')}</span>}
              </div>
            </div>
          ))
        ) : (
          <div className="text-center py-16 text-muted-foreground text-sm">No trades found</div>
        )}
      </div>

      {/* Desktop table */}
      <div className="hidden lg:block rounded-xl border border-border bg-card overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="border-border hover:bg-transparent">
              <TableHead className="text-muted-foreground font-mono text-xs">Date</TableHead>
              <TableHead className="text-muted-foreground font-mono text-xs">Market</TableHead>
              <TableHead className="text-muted-foreground font-mono text-xs">Action</TableHead>
              <TableHead className="text-muted-foreground font-mono text-xs">Side</TableHead>
              <TableHead className="text-muted-foreground font-mono text-xs text-right">Shares</TableHead>
              <TableHead className="text-muted-foreground font-mono text-xs text-right">Price</TableHead>
              <TableHead className="text-muted-foreground font-mono text-xs text-right">Total</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array(5).fill(0).map((_, i) => (
                <TableRow key={i} className="border-border">
                  {Array(7).fill(0).map((_, j) => (
                    <TableCell key={j}><div className="h-4 bg-secondary rounded animate-pulse" /></TableCell>
                  ))}
                </TableRow>
              ))
            ) : filtered.length > 0 ? (
              filtered.map((trade) => (
                <TableRow key={trade.id} className="border-border hover:bg-secondary/50">
                  <TableCell className="text-sm text-muted-foreground font-mono">
                    {trade.created_date ? format(new Date(trade.created_date), 'MMM d, HH:mm') : '-'}
                  </TableCell>
                  <TableCell className="text-sm font-medium text-foreground max-w-xs truncate">
                    {trade.market_title}
                  </TableCell>
                  <TableCell>
                    <div className={`inline-flex items-center gap-1 text-xs font-mono font-medium ${
                      trade.action === 'buy' ? 'text-accent' : 'text-destructive'
                    }`}>
                      {trade.action === 'buy' ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
                      {trade.action?.toUpperCase()}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={`text-[10px] font-mono ${
                      trade.side === 'yes' ? 'border-accent/30 text-accent' : 'border-destructive/30 text-destructive'
                    }`}>
                      {trade.side?.toUpperCase()}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm font-mono text-right">{trade.shares}</TableCell>
                  <TableCell className="text-sm font-mono text-right">{Math.round((trade.price || 0) * 100)}¢</TableCell>
                  <TableCell className={`text-sm font-mono font-bold text-right ${
                    trade.action === 'buy' ? 'text-accent' : 'text-destructive'
                  }`}>
                    ${(trade.total || 0).toFixed(2)}
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-16 text-muted-foreground">
                  No trades found
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}