import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Wallet, RefreshCw, CheckCircle2, AlertCircle } from 'lucide-react';
import { base44 } from '@/api/base44Client';

export default function BybitBalanceWidget() {
  const [balance, setBalance] = useState(null);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('loading');
  const [lastUpdated, setLastUpdated] = useState(null);
  const [errorMsg, setErrorMsg] = useState(null);

  const fetchBalance = async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await base44.functions.invoke('getBybitBalance', {});
      setBalance(res.data);
      setStatus('ok');
      setLastUpdated(new Date());
    } catch (e) {
      const errData = e.response?.data;
      setStatus('error');
      if (errData?.details?.status === 404 || errData?.statusCode === 404) {
        setErrorMsg('Balance endpoint not available on droplet. Redeploy order-server to enable.');
      } else if (errData?.error === 'Droplet unreachable') {
        setErrorMsg('Droplet is offline or unreachable.');
      } else {
        setErrorMsg(errData?.error || e.message || 'Connection failed');
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBalance();
    const interval = setInterval(fetchBalance, 120000);
    return () => clearInterval(interval);
  }, []);

  const usdt = balance?.coins?.find(c => c.coin === 'USDT');

  return (
    <Card className={status === 'ok' ? 'border-primary/20' : status === 'error' ? 'border-yellow-500/20' : 'border-border'}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <div className="flex items-center gap-2">
          <Wallet className="h-4 w-4 text-primary" />
          <CardTitle className="text-sm font-medium">Bybit Balance</CardTitle>
        </div>
        <div className="flex items-center gap-2">
          {status === 'ok' && <Badge className="bg-green-500/15 text-green-400 border-green-500/30 text-xs">Live</Badge>}
          {status === 'error' && <Badge className="bg-yellow-500/15 text-yellow-400 border-yellow-500/30 text-xs">Unavailable</Badge>}
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={fetchBalance} disabled={loading}>
            <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {status === 'error' ? (
          <div className="flex items-start gap-2 text-yellow-400">
            <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
            <p className="text-xs leading-relaxed">{errorMsg}</p>
          </div>
        ) : loading && !balance ? (
          <div className="text-muted-foreground text-sm animate-pulse">Fetching...</div>
        ) : (
          <div className="space-y-2">
            <div className="flex items-baseline gap-1">
              <span className="text-2xl font-bold font-mono">
                ${Number(balance?.totalEquity || 0).toFixed(2)}
              </span>
              <span className="text-xs text-muted-foreground">equity</span>
            </div>
            {usdt && (
              <div className="text-sm font-mono text-primary">
                {Number(usdt.walletBalance).toFixed(2)} USDT
              </div>
            )}
            {balance?.coins?.filter(c => Number(c.usdValue) > 0.01).length > 0 && (
              <div className="grid grid-cols-2 gap-1 text-xs">
                {balance.coins.filter(c => Number(c.usdValue) > 0.01).map(coin => (
                  <div key={coin.coin} className="flex justify-between bg-secondary/50 rounded px-2 py-0.5">
                    <span className="text-muted-foreground font-mono">{coin.coin}</span>
                    <span className="font-mono">${Number(coin.usdValue).toFixed(2)}</span>
                  </div>
                ))}
              </div>
            )}
            <div className="flex items-center gap-1.5 pt-1 border-t border-border/50">
              <CheckCircle2 className="h-3 w-3 text-green-400" />
              <span className="text-xs text-muted-foreground">
                {balance?.testnet ? 'Testnet' : 'Mainnet'} · {lastUpdated?.toLocaleTimeString() || '—'}
              </span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}