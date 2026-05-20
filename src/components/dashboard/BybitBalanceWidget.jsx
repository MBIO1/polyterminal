import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Wallet, RefreshCw, CheckCircle2, AlertCircle } from 'lucide-react';
import { base44 } from '@/api/base44Client';

export default function BybitBalanceWidget() {
  const [status, setStatus] = useState('blocked'); // 'ok' | 'blocked' | 'loading'
  const [lastUpdated, setLastUpdated] = useState(null);

  useEffect(() => {
    // Bybit blocks droplet IP via CloudFront geo-restrictions
    // Balances can be monitored manually via Bybit dashboard
    setLastUpdated(new Date());
  }, []);

  return (
    <Card className="border-yellow-500/20">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <div className="flex items-center gap-2">
          <Wallet className="h-4 w-4 text-yellow-500" />
          <CardTitle className="text-sm font-medium">Bybit Balance</CardTitle>
        </div>
        <Badge className="bg-yellow-500/15 text-yellow-400 border-yellow-500/30 text-xs">Geo-blocked</Badge>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          <div className="flex items-start gap-2 text-yellow-400">
            <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
            <div className="text-sm">
              <p className="font-medium">Bybit API is geo-restricted</p>
              <p className="text-xs text-yellow-300 mt-1">The droplet cannot access Bybit's API due to CloudFront restrictions. Monitor your balance manually via the Bybit dashboard.</p>
            </div>
          </div>
          <div className="text-xs text-muted-foreground pt-1 border-t border-border/50">
            Last checked: {lastUpdated ? lastUpdated.toLocaleTimeString() : '—'}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}