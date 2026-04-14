import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Search } from 'lucide-react';
import MarketCard from '@/components/markets/MarketCard';
import TradeModal from '@/components/markets/TradeModal';
import { toast } from 'sonner';

const categories = ['all', 'politics', 'crypto', 'sports', 'entertainment', 'science', 'economics', 'world'];

export default function Markets() {
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  const [tradeMarket, setTradeMarket] = useState(null);
  const [tradeSide, setTradeSide] = useState('yes');
  const queryClient = useQueryClient();

  const { data: markets = [], isLoading } = useQuery({
    queryKey: ['markets'],
    queryFn: () => base44.entities.Market.list('-volume'),
  });

  const tradeMutation = useMutation({
    mutationFn: async ({ market, side, action, shares, price, total }) => {
      await base44.entities.Trade.create({
        market_id: market.id,
        market_title: market.title,
        side,
        action,
        shares,
        price,
        total,
      });
      // Create or update position
      const existingPositions = await base44.entities.Position.filter({
        market_id: market.id,
        side,
        status: 'open',
      });
      if (existingPositions.length > 0) {
        const pos = existingPositions[0];
        const newShares = pos.shares + shares;
        const newAvg = ((pos.shares * pos.avg_price) + (shares * price)) / newShares;
        await base44.entities.Position.update(pos.id, {
          shares: newShares,
          avg_price: newAvg,
          current_price: price,
        });
      } else {
        await base44.entities.Position.create({
          market_id: market.id,
          market_title: market.title,
          side,
          shares,
          avg_price: price,
          current_price: price,
          status: 'open',
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['positions'] });
      queryClient.invalidateQueries({ queryKey: ['trades-recent'] });
      queryClient.invalidateQueries({ queryKey: ['trades'] });
      toast.success('Trade executed successfully');
    },
  });

  const handleTrade = (market, side) => {
    setTradeMarket(market);
    setTradeSide(side);
  };

  const filtered = markets.filter((m) => {
    const matchesSearch = m.title?.toLowerCase().includes(search.toLowerCase());
    const matchesCategory = category === 'all' || m.category === category;
    return matchesSearch && matchesCategory;
  });

  return (
    <div className="p-4 md:p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Markets</h1>
        <p className="text-sm text-muted-foreground mt-1">Browse and trade prediction markets</p>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search markets..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10 bg-secondary border-border font-sans"
          />
        </div>
      </div>

      <div className="overflow-x-auto -mx-4 px-4">
        <Tabs value={category} onValueChange={setCategory}>
          <TabsList className="bg-secondary inline-flex">
            {categories.map((cat) => (
              <TabsTrigger key={cat} value={cat} className="font-mono text-xs capitalize">
                {cat === 'all' ? 'All' : cat}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      {/* Grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array(6).fill(0).map((_, i) => (
            <div key={i} className="h-64 rounded-xl bg-card border border-border animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((market) => (
            <MarketCard key={market.id} market={market} onTrade={handleTrade} />
          ))}
          {filtered.length === 0 && (
            <div className="col-span-full text-center py-16 text-muted-foreground">
              No markets found
            </div>
          )}
        </div>
      )}

      <TradeModal
        market={tradeMarket}
        initialSide={tradeSide}
        open={!!tradeMarket}
        onClose={() => setTradeMarket(null)}
        onSubmit={(data) => tradeMutation.mutateAsync(data)}
      />
    </div>
  );
}