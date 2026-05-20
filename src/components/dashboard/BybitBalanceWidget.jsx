import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Wallet, RefreshCw, CheckCircle2, AlertCircle } from 'lucide-react';
import { base44 } from '@/api/base44Client';

export default function BybitBalanceWidget() {
  const [balance, setBalance] = useState(null);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('loading'); // 'ok' | 'error' | 'loading'
  const [lastUpdated, setLastUpdated] = useState(null);
  const [errorDetails, setErrorDetails] = useState(null);

  const fetchBalance = async () => {
    setLoading(true);
    setStatus('loading');
    setErrorDetails(null);
    try {
      const res = await base44.functions.invoke('getBybitBalance', {});
      setBalance(res.data);
      setStatus('ok');
      setLastUpdated(new Date());
    } catch (e) {
      setStatus('error');
      setErrorDetails(e.response?.data || { error: e.message });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBalance();
    const interval = setInterval(fetchBalance, 60000); // refresh every 60s
    return () => clearInterval(interval);
  }, []);

  const usdt = balance?.coins?.find(c => c.coin === 'USDT');

  return (
    <Card className="border-primary/20">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <div className="flex items-center gap-2">
          <Wallet className="h-4 w-4 text-primary" />
          <CardTitle className="text-sm font-medium">Bybit Balance</CardTitle>
        </div>
        <div className="flex items-center gap-2">
          {status === 'ok' && <Badge className="bg-green-500/15 text-green-400 border-green-500/30 text-xs">Live</Badge>}
          {status === 'error' && <Badge className="bg-red-500/15 text-red-400 border-red-500/30 text-xs">Error</Badge>}
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={fetchBalance} disabled={loading}>
            <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {status === 'error' ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-red-400">
              <AlertCircle className="h-4 w-4" />
              <span className="text-sm font-medium">{errorDetails?.error || 'Connection failed'}</span>
            </div>
            {errorDetails?.details && (
              <div className="text-xs text-red-300 font-mono bg-red-950/30 rounded p-2">
                {errorDetails.details}
              </div>
            )}
            {errorDetails?.dropletIp && (
              <div className="text-xs text-muted-foreground">
                Droplet: {errorDetails.dropletIp}:{errorDetails.port || '?'}
              </div>
            )}
            {errorDetails?.hint && (
              <div className="text-xs text-yellow-400 italic">{errorDetails.hint}</div>
            )}
          </div>
        ) : loading && !balance ? (
          <div className="text-muted-foreground text-sm animate-pulse">Fetching from Bybit...</div>
        ) : (
          <div className="space-y-3">
            <div>
              <div className="flex items-baseline gap-1">
                <span className="text-2xl font-bold font-mono">
                  ${Number(balance?.totalEquity || 0).toFixed(2)}
                </span>
                <span className="text-xs text-muted-foreground">USD total equity</span>
              </div>
              {usdt && (
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-sm font-mono text-primary">{Number(usdt.walletBalance).toFixed(2)} USDT</span>
                  <span className="text-xs text-muted-foreground">wallet balance</span>
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs">
              {balance?.coins?.filter(c => Number(c.usdValue) > 0.001).map(coin => (
                <div key={coin.coin} className="flex justify-between bg-secondary/50 rounded px-2 py-1">
                  <span className="text-muted-foreground font-mono">{coin.coin}</span>
                  <span className="font-mono">${Number(coin.usdValue).toFixed(4)}</span>
                </div>
              ))}
            </div>

            <div className="flex items-center gap-1.5 pt-1 border-t border-border/50">
              <CheckCircle2 className="h-3 w-3 text-green-400" />
              <span className="text-xs text-muted-foreground">
                Mainnet · {lastUpdated ? lastUpdated.toLocaleTimeString() : '—'}
              </span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}