import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Activity, CheckCircle2, AlertCircle } from 'lucide-react';

export default function ConnectionStatus() {
  const [status, setStatus] = useState({
    trades: 'disconnected',
    signals: 'disconnected',
    heartbeats: 'disconnected',
  });

  useEffect(() => {
    // Check initial connection by recent activity freshness, not mere record existence
    const checkInitialConnections = async () => {
      try {
        const [trades, signals, heartbeats] = await Promise.all([
          base44.entities.ArbTrade.list('-created_date', 1),
          base44.entities.ArbSignal.list('-created_date', 1),
          base44.entities.ArbHeartbeat.list('-created_date', 1),
        ]);

        const now = Date.now();
        const getAgeMs = (row, field) => row?.[field] ? now - new Date(row[field]).getTime() : Infinity;
        const latestTrade = trades[0];
        const latestSignal = signals[0];
        const latestHeartbeat = heartbeats[0];

        setStatus({
          trades: latestTrade ? (getAgeMs(latestTrade, 'updated_date') < 24 * 60 * 60 * 1000 ? 'connected' : 'disconnected') : 'connected',
          signals: latestSignal ? (getAgeMs(latestSignal, 'received_time') < 10 * 60 * 1000 ? 'connected' : 'disconnected') : 'disconnected',
          heartbeats: latestHeartbeat ? (getAgeMs(latestHeartbeat, 'snapshot_time') < 3 * 60 * 1000 ? 'connected' : 'disconnected') : 'disconnected',
        });
      } catch (error) {
        console.error('Connection check failed:', error);
      }
    };

    checkInitialConnections();

    // Subscribe to each entity for real-time updates
    const unsubTrades = base44.entities.ArbTrade.subscribe(() => {
      setStatus(prev => ({ ...prev, trades: 'connected' }));
    });

    const unsubSignals = base44.entities.ArbSignal.subscribe(() => {
      setStatus(prev => ({ ...prev, signals: 'connected' }));
    });

    const unsubHeartbeats = base44.entities.ArbHeartbeat.subscribe(() => {
      setStatus(prev => ({ ...prev, heartbeats: 'connected' }));
    });

    return () => {
      unsubTrades();
      unsubSignals();
      unsubHeartbeats();
    };
  }, []);

  const StatusIndicator = ({ name, state }) => (
    <div className="flex items-center gap-2">
      {state === 'connected' ? (
        <CheckCircle2 className="w-3.5 h-3.5 text-green-400" />
      ) : (
        <AlertCircle className="w-3.5 h-3.5 text-yellow-400" />
      )}
      <span className="text-xs font-mono">{name}</span>
      <Badge variant={state === 'connected' ? 'default' : 'secondary'} className="text-[10px] h-4">
        {state}
      </Badge>
    </div>
  );

  return (
    <Card className="border-border/50">
      <CardContent className="pt-4">
        <div className="flex items-center gap-2 mb-3">
          <Activity className="w-4 h-4 text-primary" />
          <span className="text-xs font-semibold">Real-time Connections</span>
        </div>
        <div className="space-y-2">
          <StatusIndicator name="Trades" state={status.trades} />
          <StatusIndicator name="Signals" state={status.signals} />
          <StatusIndicator name="Heartbeats" state={status.heartbeats} />
        </div>
      </CardContent>
    </Card>
  );
}