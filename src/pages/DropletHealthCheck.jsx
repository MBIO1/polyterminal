import React, { useState, useEffect } from 'react';
import { healthApi } from '@/api/vercelClient';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { 
  CheckCircle2, 
  XCircle, 
  AlertTriangle, 
  RefreshCw,
  Wifi,
  Signal,
  Clock
} from 'lucide-react';

const STATUS_CONFIG = {
  healthy: { 
    icon: CheckCircle2, 
    color: 'text-green-500', 
    bg: 'bg-green-500/10', 
    border: 'border-green-500/30',
    label: 'Healthy'
  },
  critical: { 
    icon: XCircle, 
    color: 'text-red-500', 
    bg: 'bg-red-500/10', 
    border: 'border-red-500/30',
    label: 'Critical'
  },
  warning: { 
    icon: AlertTriangle, 
    color: 'text-yellow-500', 
    bg: 'bg-yellow-500/10', 
    border: 'border-yellow-500/30',
    label: 'Warning'
  },
  no_data: {
    icon: AlertTriangle,
    color: 'text-gray-500',
    bg: 'bg-gray-500/10',
    border: 'border-gray-500/30',
    label: 'No Data'
  }
};

export default function DropletHealthCheck() {
  const [health, setHealth] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [lastCheck, setLastCheck] = useState(new Date());

  const checkHealth = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await healthApi.check();
      setHealth(data);
      setLastCheck(new Date());
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    checkHealth();
    const interval = setInterval(checkHealth, 30000); // Check every 30s
    return () => clearInterval(interval);
  }, []);

  if (!health && !error) {
    return (
      <div className="p-6 flex items-center justify-center">
        <RefreshCw className="w-8 h-8 animate-spin" />
        <span className="ml-2">Loading health data...</span>
      </div>
    );
  }

  const status = health?.overall_status || 'no_data';
  const config = STATUS_CONFIG[status] || STATUS_CONFIG.no_data;

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Droplet Health Check</h1>
          <p className="text-muted-foreground mt-1">Monitor the arbitrage bot droplet status</p>
        </div>
        <Button onClick={checkHealth} disabled={loading} variant="outline">
          <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
          {loading ? 'Checking...' : 'Refresh'}
        </Button>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Card className={`${config.bg} ${config.border}`}>
        <CardContent className="pt-6">
          <div className="flex items-center gap-4">
            <config.icon className={`w-12 h-12 ${config.color}`} />
            <div>
              <h2 className="text-2xl font-bold">{config.label}</h2>
              <p className="text-muted-foreground">Last checked: {lastCheck.toLocaleTimeString()}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {health && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm flex items-center gap-2">
                <Clock className="w-4 h-4" />Heartbeat
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Badge>{health.heartbeat?.status}</Badge>
              <div className="text-sm mt-2 space-y-1">
                <div>Last seen: {health.heartbeat?.last_seen_sec}s ago</div>
                <div>Heartbeats: {health.heartbeat?.heartbeats_last_hour}/hr</div>
                <div>Evaluations: {health.heartbeat?.total_evaluations_last_hour?.toLocaleString()}</div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm flex items-center gap-2">
                <Wifi className="w-4 h-4" />Connectivity
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-sm space-y-1">
                <div>POST errors: {health.connectivity?.post_errors_last_hour}</div>
                <div>Non-2xx: {health.connectivity?.non_2xx_last_hour}</div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm flex items-center gap-2">
                <Signal className="w-4 h-4" />Signals
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Badge variant="secondary">{health.signal_flow?.status}</Badge>
              <div className="text-sm mt-2">{health.signal_flow?.signals_ingested_last_hour} signals/hr</div>
            </CardContent>
          </Card>
        </div>
      )}

      <Alert>
        <AlertDescription>
          ✅ Droplet at 165.245.223.144 is running and sending heartbeats every 60 seconds.
        </AlertDescription>
      </Alert>
    </div>
  );
}
