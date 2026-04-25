import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { 
  Activity, 
  CheckCircle2, 
  XCircle, 
  AlertTriangle, 
  RefreshCw,
  Server,
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
    pulse: false,
    label: 'Healthy'
  },
  recovered: { 
    icon: CheckCircle2, 
    color: 'text-green-500', 
    bg: 'bg-green-500/20', 
    border: 'border-green-500/50',
    pulse: true,
    label: 'Recovered'
  },
  warning: { 
    icon: AlertTriangle, 
    color: 'text-yellow-500', 
    bg: 'bg-yellow-500/10', 
    border: 'border-yellow-500/30',
    pulse: false,
    label: 'Warning'
  },
  critical: { 
    icon: XCircle, 
    color: 'text-red-500', 
    bg: 'bg-red-500/10', 
    border: 'border-red-500/30',
    pulse: true,
    label: 'Critical'
  },
  unknown: { 
    icon: Activity, 
    color: 'text-gray-500', 
    bg: 'bg-gray-500/10', 
    border: 'border-gray-500/30',
    pulse: false,
    label: 'Unknown'
  },
};

export default function DropletHealthCheck() {
  const [health, setHealth] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [lastCheck, setLastCheck] = useState(null);
  const [previousStatus, setPreviousStatus] = useState(null);
  const [recoveryTime, setRecoveryTime] = useState(null);
  const [downtimeDuration, setDowntimeDuration] = useState(null);

  const checkHealth = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await base44.functions.invoke('dropletHealth', {});
      const newHealth = res.data;
      
      // Track status transitions
      if (previousStatus && previousStatus !== 'healthy' && newHealth.overall_status === 'healthy') {
        // Recovery detected!
        setRecoveryTime(new Date());
        if (lastCheck) {
          setDowntimeDuration(Math.floor((new Date() - lastCheck) / 1000));
        }
      }
      
      setPreviousStatus(newHealth.overall_status);
      setHealth(newHealth);
      setLastCheck(new Date());
    } catch (e) {
      setError(e?.response?.data?.error || e.message || 'Failed to check droplet health');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    checkHealth();
    const interval = setInterval(checkHealth, 60000); // Auto-refresh every minute
    return () => clearInterval(interval);
  }, []);

  const getStatusConfig = (status) => STATUS_CONFIG[status] || STATUS_CONFIG.unknown;

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Droplet Health Check</h1>
          <p className="text-muted-foreground mt-1">
            Monitor the arbitrage bot droplet status and connectivity · <span className="text-destructive font-semibold">⚠️ Live Bybit trades executing</span>
          </p>
        </div>
        <Button onClick={checkHealth} disabled={loading} variant="outline">
          <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
          {loading ? 'Checking...' : 'Refresh'}
        </Button>
      </div>

      {error && (
        <Alert variant="destructive">
          <XCircle className="h-4 w-4" />
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {health && (
        <>
          {/* Overall Status */}
          <Card className={`${getStatusConfig(health.overall_status).bg} ${getStatusConfig(health.overall_status).border} ${getStatusConfig(health.overall_status).pulse ? 'animate-pulse' : ''}`}>
            <CardContent className="pt-6">
              <div className="flex items-center gap-4">
                {React.createElement(getStatusConfig(health.overall_status).icon, {
                  className: `w-12 h-12 ${getStatusConfig(health.overall_status).color} ${getStatusConfig(health.overall_status).pulse ? 'animate-bounce' : ''}`
                })}
                <div>
                  <h2 className="text-2xl font-bold capitalize">
                    {getStatusConfig(health.overall_status).label}
                  </h2>
                  <p className="text-muted-foreground">
                    Last checked: {lastCheck?.toLocaleTimeString()}
                  </p>
                  {recoveryTime && health.overall_status === 'healthy' && (
                    <p className="text-green-400 text-sm mt-1">
                      ✓ Recovered at {recoveryTime.toLocaleTimeString()}
                      {downtimeDuration && ` (downtime: ${Math.floor(downtimeDuration / 60)}m ${downtimeDuration % 60}s)`}
                    </p>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Issues */}
          {health.issues?.length > 0 && (
            <Alert variant="warning" className="border-yellow-500/50 bg-yellow-500/10">
              <AlertTriangle className="h-4 w-4 text-yellow-600" />
              <AlertTitle>Issues Detected</AlertTitle>
              <AlertDescription>
                <ul className="list-disc list-inside mt-2 space-y-1">
                  {health.issues.map((issue, i) => (
                    <li key={i} className="text-sm">{issue}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}

          {/* Status Grid */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Heartbeat Status */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Clock className="w-4 h-4" />
                  Heartbeat
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-2 mb-2">
                  <Badge variant={health.heartbeat.status === 'healthy' ? 'default' : 'destructive'}>
                    {health.heartbeat.status}
                  </Badge>
                </div>
                <div className="space-y-1 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Last seen:</span>
                    <span>{health.heartbeat.last_seen_sec !== null ? `${health.heartbeat.last_seen_sec}s ago` : 'Never'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Heartbeats (1h):</span>
                    <span>{health.heartbeat.heartbeats_last_hour}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Evaluations (1h):</span>
                    <span>{health.heartbeat.total_evaluations_last_hour?.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Posted (1h):</span>
                    <span>{health.heartbeat.total_posted_last_hour}</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Connectivity */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Wifi className="w-4 h-4" />
                  Connectivity
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">POST errors (1h)</span>
                    <Badge variant={health.connectivity.post_errors_last_hour > 0 ? 'destructive' : 'secondary'}>
                      {health.connectivity.post_errors_last_hour}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Non-2xx responses (1h)</span>
                    <Badge variant={health.connectivity.non_2xx_last_hour > 0 ? 'destructive' : 'secondary'}>
                      {health.connectivity.non_2xx_last_hour}
                    </Badge>
                  </div>
                  {health.connectivity.issues.length === 0 && (
                    <p className="text-sm text-green-600 flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3" /> No connectivity issues
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Signal Flow */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Signal className="w-4 h-4" />
                  Signal Flow
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-2 mb-2">
                  <Badge variant={
                    health.signal_flow.status === 'flowing' ? 'default' :
                    health.signal_flow.status === 'blocked' ? 'destructive' : 'secondary'
                  }>
                    {health.signal_flow.status}
                  </Badge>
                </div>
                <div className="space-y-1 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Signals ingested (1h):</span>
                    <span>{health.signal_flow.signals_ingested_last_hour}</span>
                  </div>
                  {health.signal_flow.last_signal_at && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Last signal:</span>
                      <span>{new Date(health.signal_flow.last_signal_at).toLocaleTimeString()}</span>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* WebSocket Book Freshness */}
          {health.websocket_books?.status !== 'unknown' && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Server className="w-4 h-4" />
                  WebSocket Order Book Freshness
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-2 mb-3">
                  <Badge variant={
                    health.websocket_books.status === 'healthy' ? 'default' :
                    health.websocket_books.status === 'degraded' ? 'warning' : 'destructive'
                  }>
                    {health.websocket_books.status}
                  </Badge>
                  <span className="text-sm text-muted-foreground">{health.websocket_books.details}</span>
                </div>
                {health.websocket_books.venues && (
                  <code className="text-xs bg-secondary p-2 rounded block overflow-x-auto">
                    {health.websocket_books.venues}
                  </code>
                )}
              </CardContent>
            </Card>
          )}

          {/* Recommendations */}
          {health.recommendations?.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Recommendations</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {health.recommendations.map((rec, i) => (
                    <div key={i} className="flex items-start gap-3 p-3 bg-secondary/50 rounded-lg">
                      <Badge variant={rec.priority === 'P0' ? 'destructive' : rec.priority === 'P1' ? 'warning' : 'secondary'}>
                        {rec.priority}
                      </Badge>
                      <div>
                        <p className="font-medium text-sm">{rec.action}</p>
                        <p className="text-sm text-muted-foreground">{rec.details}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Latest Diagnostics */}
          {health.diagnostics && (
            <Card>
              <CardHeader>
                <CardTitle>Latest Diagnostics</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                  <div className="p-3 bg-secondary/50 rounded">
                    <div className="text-muted-foreground text-xs">Best Edge</div>
                    <div className="font-mono font-medium">{health.diagnostics.best_edge_bps?.toFixed(2)} bps</div>
                    <div className="text-xs text-muted-foreground">{health.diagnostics.best_edge_pair}</div>
                  </div>
                  <div className="p-3 bg-secondary/50 rounded">
                    <div className="text-muted-foreground text-xs">Rejected (Edge)</div>
                    <div className="font-mono font-medium">{health.diagnostics.rejected_edge}</div>
                  </div>
                  <div className="p-3 bg-secondary/50 rounded">
                    <div className="text-muted-foreground text-xs">Rejected (Fillable)</div>
                    <div className="font-mono font-medium">{health.diagnostics.rejected_fillable}</div>
                  </div>
                  <div className="p-3 bg-secondary/50 rounded">
                    <div className="text-muted-foreground text-xs">Rejected (Stale)</div>
                    <div className="font-mono font-medium">{health.diagnostics.rejected_stale}</div>
                  </div>
                  <div className="p-3 bg-secondary/50 rounded">
                    <div className="text-muted-foreground text-xs">Venue Checks</div>
                    <div className="font-mono font-medium">{health.diagnostics.venue_pair_checks}</div>
                  </div>
                  <div className="p-3 bg-secondary/50 rounded">
                    <div className="text-muted-foreground text-xs">No Book</div>
                    <div className="font-mono font-medium">{health.diagnostics.venue_no_book}</div>
                  </div>
                  <div className="p-3 bg-secondary/50 rounded">
                    <div className="text-muted-foreground text-xs">Stale Book</div>
                    <div className="font-mono font-medium">{health.diagnostics.venue_stale_book}</div>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}