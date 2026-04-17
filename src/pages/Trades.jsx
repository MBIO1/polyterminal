import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { format, isWithinInterval, parseISO, startOfDay, endOfDay } from 'date-fns';
import { Search, Filter } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';

const OUTCOME_COLORS = {
  win:     'border-accent/40 text-accent bg-accent/5',
  loss:    'border-destructive/40 text-destructive bg-destructive/5',
  pending: 'border-primary/40 text-primary bg-primary/5',
  cancelled: 'border-muted text-muted-foreground',
};

export default function Trades() {
  const [search, setSearch]         = useState('');
  const [outcome, setOutcome]       = useState('all');
  const [asset, setAsset]           = useState('all');
  const [dateFrom, setDateFrom]     = useState('');
  const [dateTo, setDateTo]         = useState('');

  const { data: trades = [], isLoading } = useQuery({
    queryKey: ['bot-trades-log'],
    queryFn: () => base44.entities.BotTrade.list('-created_date', 500),
  });

  const filtered = useMemo(() => {
    return trades.filter(t => {
      if (outcome !== 'all' && t.outcome !== outcome) return false;
      if (asset !== 'all' && t.asset !== asset) return false;
      if (search && !t.market_title?.toLowerCase().includes(search.toLowerCase()) &&
          !t.contract_type?.toLowerCase().includes(search.toLowerCase())) return false;
      if (dateFrom || dateTo) {
        const d = t.created_date ? parseISO(t.created_date) : null;
        if (!d) return false;
        if (dateFrom && d < startOfDay(parseISO(dateFrom))) return false;
        if (dateTo   && d > endOfDay(parseISO(dateTo)))     return false;
      }
      return true;
    });
  }, [trades, outcome, asset, search, dateFrom, dateTo]);

  const stats = useMemo(() => {
    const resolved = filtered.filter(t => t.outcome === 'win' || t.outcome === 'loss');
    const wins = resolved.filter(t => t.outcome === 'win');
    const totalPnl = filtered.reduce((s, t) => s + (t.pnl_usdc || 0), 0);
    const winRate = resolved.length > 0 ? (wins.length / resolved.length * 100).toFixed(1) : '–';
    return { total: filtered.length, winRate, totalPnl };
  }, [filtered]);

  const clearFilters = () => {
    setOutcome('all'); setAsset('all'); setSearch(''); setDateFrom(''); setDateTo('');
  };

  const hasFilters = outcome !== 'all' || asset !== 'all' || search || dateFrom || dateTo;

  return (
    <div className="p-4 md:p-6 max-w-[1400px] mx-auto space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Bot Trade Log</h1>
          <p className="text-xs text-muted-foreground mt-1 font-mono">
            {stats.total} trades · Win rate {stats.winRate}% · P&L {stats.totalPnl >= 0 ? '+' : ''}${stats.totalPnl.toFixed(2)}
          </p>
        </div>
        {hasFilters && (
          <Button variant="ghost" size="sm" onClick={clearFilters} className="text-xs text-muted-foreground">
            Clear filters ×
          </Button>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input placeholder="Search market / contract..." value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9 bg-secondary border-border text-xs h-9" />
        </div>

        <Select value={outcome} onValueChange={setOutcome}>
          <SelectTrigger className="w-36 h-9 text-xs bg-secondary border-border">
            <SelectValue placeholder="Outcome" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All outcomes</SelectItem>
            <SelectItem value="win">Win</SelectItem>
            <SelectItem value="loss">Loss</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="cancelled">Cancelled</SelectItem>
          </SelectContent>
        </Select>

        <Select value={asset} onValueChange={setAsset}>
          <SelectTrigger className="w-32 h-9 text-xs bg-secondary border-border">
            <SelectValue placeholder="Asset" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All assets</SelectItem>
            <SelectItem value="BTC">BTC</SelectItem>
            <SelectItem value="ETH">ETH</SelectItem>
          </SelectContent>
        </Select>

        <div className="flex items-center gap-2">
          <Filter className="w-3.5 h-3.5 text-muted-foreground" />
          <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
            className="w-36 h-9 text-xs bg-secondary border-border font-mono" />
          <span className="text-xs text-muted-foreground">→</span>
          <Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
            className="w-36 h-9 text-xs bg-secondary border-border font-mono" />
        </div>
      </div>

      {/* Table */}
      <div className="rounded-xl border border-border bg-card overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="border-border hover:bg-transparent">
              {['Date/Time','Asset','Contract','Side','Entry','CEX Prob','Size','P&L','Outcome','Notes'].map(h => (
                <TableHead key={h} className="text-muted-foreground font-mono text-[11px] whitespace-nowrap">{h}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array(8).fill(0).map((_, i) => (
                <TableRow key={i} className="border-border">
                  {Array(10).fill(0).map((_, j) => (
                    <TableCell key={j}><div className="h-3.5 bg-secondary rounded animate-pulse" /></TableCell>
                  ))}
                </TableRow>
              ))
            ) : filtered.length > 0 ? (
              filtered.map(t => (
                <TableRow key={t.id} className="border-border/50 hover:bg-secondary/30 text-xs font-mono">
                  <TableCell className="text-muted-foreground whitespace-nowrap">
                    {t.created_date ? format(new Date(t.created_date), 'MMM d HH:mm') : '–'}
                  </TableCell>
                  <TableCell>
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                      t.asset === 'BTC' ? 'bg-chart-4/10 text-chart-4' : 'bg-primary/10 text-primary'
                    }`}>{t.asset}</span>
                  </TableCell>
                  <TableCell className="text-foreground whitespace-nowrap">
                    {t.contract_type?.replace(/_/g, ' ') || t.market_title?.slice(0, 20)}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={`text-[10px] ${
                      t.side === 'yes' ? 'border-accent/40 text-accent' : 'border-destructive/40 text-destructive'
                    }`}>{t.side?.toUpperCase()}</Badge>
                  </TableCell>
                  <TableCell className="text-right">{t.entry_price != null ? `${Math.round(t.entry_price * 100)}¢` : '–'}</TableCell>
                  <TableCell className="text-right text-primary">
                    {t.confidence_at_entry != null ? `${t.confidence_at_entry.toFixed(0)}%` : '–'}
                  </TableCell>
                  <TableCell className="text-right">${(t.size_usdc || 0).toFixed(2)}</TableCell>
                  <TableCell className={`text-right font-bold ${
                    (t.pnl_usdc || 0) > 0 ? 'text-accent' : (t.pnl_usdc || 0) < 0 ? 'text-destructive' : 'text-muted-foreground'
                  }`}>
                    {t.pnl_usdc != null ? `${t.pnl_usdc >= 0 ? '+' : ''}$${t.pnl_usdc.toFixed(2)}` : '–'}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={`text-[10px] ${OUTCOME_COLORS[t.outcome] || ''}`}>
                      {t.outcome}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground max-w-[200px] truncate" title={t.notes}>
                    {t.notes || '–'}
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={10} className="text-center py-16 text-muted-foreground">
                  No trades match the current filters
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}