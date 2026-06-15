import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { 
  Activity, 
  Server, 
  CheckCircle2, 
  AlertTriangle, 
  XCircle,
  RefreshCw,
  Zap,
  Clock,
  TrendingUp,
  Wifi,
  WifiOff
} from 'lucide-react';

const STATUS_COLORS = {
  healthy: 'text-green-400 bg-green-500/10 border-green-500/30',
  degraded: 'text-yellow-400 bg-yellow-500/10 border-yellow-500/30',
  critical: 'text-red-400 bg-red-500/10 border-red-500/30',
  low_opportunity: 'text-blue-400 bg-blue-500/10 border-blue-500/30'
};

const STATUS_ICONS = {
  healthy: CheckCircle2,
  degraded: AlertTriangle,
  critical: XCircle,
  low_opportunity: Activity
};

export default function DropletHealthWidget() {
  const [health, setHealth] = useState(null);
  const [loading, setLoading] = useState(true);
  const [lastCheck, setLastCheck] = useState(null);

  const checkHealth = async () => {
    try {
      setLoading(true);
      const res = await base44.functions.invoke('dropletHealthMonitor', {});
      setHealth(res.data.health);
      setLastCheck(new Date());
    } catch (error) {
      console.error('Health check failed:', error);
      // Show degraded status on error instead of empty
      setHealth({
        overall_status: 'degraded',
        checks: {
          tokenauth: { status: 'unknown', details: 'Health monitor unreachable' },
          websocket: { status: 'unknown', details: 'Check droplet connectivity' },
        },
        alerts: [{ severity: 'medium', message: 'Health check failed - Cloudflare protection or network issue' }],
        recommendations: [{ action: 'Verify droplet can reach Base44 endpoints' }],
        metrics: { rejection_breakdown: {}, gateway_performance: {} }
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    checkHealth();
    
    // Subscribe to heartbeat updates for real-time health
    const unsubscribe = base44.entities.ArbHeartbeat.subscribe(() => {
      console.log('Heartbeat update - refreshing health');
      checkHealth();
    });

    // Periodic check every 2 minutes
    const interval = setInterval(checkHealth, 120000);

    return () => {
      unsubscribe();
      clearInterval(interval);
    };
  }, []);

  if (loading && !health) {
    return (
      <Card>
        <CardContent className="pt-5 pb-4">
          <div className="flex items-center gap-2 text-muted-foreground">
            <RefreshCw className="w-4 h-4 animate-spin" />
            <span className="text-sm">Running health diagnostics...</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!health) {
    return (
      <Card>
        <CardContent className="pt-5 pb-4">
          <div className="flex items-center gap-2 text-red-400">
            <XCircle className="w-4 h-4" />
            <span className="text-sm">Health check unavailable</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  const StatusIcon = STATUS_ICONS[health.overall_status] || Activity;
  const statusColor = STATUS_COLORS[health.overall_status] || STATUS_COLORS.degraded;

  const renderCheck = (key, check) => {
    if (!check) return null;
    const Icon = check.status === 'healthy' ? CheckCircle2 : check.status === 'critical' ? XCircle : AlertTriangle;
    const color = check.status === 'healthy' ? 'text-green-400' : check.status === 'critical' ? 'text-red-400' : 'text-yellow-400';
    
    return (
      <div key={key} className="flex items-start gap-2 p-2 rounded-lg bg-secondary/30">
        <Icon className={`w-3.5 h-3.5 flex-shrink-0 mt-0.5 ${color}`} />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold capitalize">{key.replace(/_/g, ' ')}</p>
          <p className={`text-xs font-mono mt-0.5 ${color}`}>{check.details}</p>
        </div>
      </div>
    );
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Server className="w-4 h-4 text-primary" />
            <CardTitle className="text-base">Droplet Health</CardTitle>
          </div>
          <Button 
            onClick={checkHealth} 
            variant="ghost" 
            size="sm"
            disabled={loading}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
        
        {/* Overall status */}
        <div className={`mt-3 flex items-center gap-2 px-3 py-2 rounded-lg border ${statusColor}`}>
          <StatusIcon className="w-4 h-4" />
          <span className="text-sm font-bold capitalize">{health.overall_status.replace('_', ' ')}</span>
          {lastCheck && (
            <span className="text-xs opacity-60 ml-auto">
              {lastCheck.toLocaleTimeString()}
            </span>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-2">
        {/* Key checks */}
        {health.checks && (
          <>
            {renderCheck('tokenauth', health.checks.tokenauth)}
            {renderCheck('websocket', health.checks.websocket)}
            {renderCheck('signal_flow', health.checks.signal_flow)}
            {renderCheck('book_freshness', health.checks.book_freshness)}
            {renderCheck('edge_quality', health.checks.edge_quality)}
            {renderCheck('signal_latency', health.checks.signal_latency)}
          </>
        )}

        {/* Alerts */}
        {health.alerts && health.alerts.length > 0 && (
          <div className="mt-3 pt-3 border-t border-border">
            <p className="text-xs font-semibold text-muted-foreground mb-2 flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" />
              Alerts ({health.alerts.length})
            </p>
            <div className="space-y-1">
              {health.alerts.slice(0, 3).map((alert, i) => (
                <div 
                  key={i}
                  className={`text-xs p-2 rounded ${
                    alert.severity === 'critical' 
                      ? 'bg-red-500/10 text-red-400 border border-red-500/30' 
                      : 'bg-yellow-500/10 text-yellow-400 border border-yellow-500/30'
                  }`}
                >
                  {alert.message}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Recommendations */}
        {health.recommendations && health.recommendations.length > 0 && (
          <div className="mt-3 pt-3 border-t border-border">
            <p className="text-xs font-semibold text-muted-foreground mb-2 flex items-center gap-1">
              <TrendingUp className="w-3 h-3" />
              Recommendations
            </p>
            <div className="space-y-1">
              {health.recommendations.slice(0, 2).map((rec, i) => (
                <div key={i} className="text-xs p-2 rounded bg-blue-500/10 text-blue-400 border border-blue-500/30">
                  {rec.action}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Metrics summary */}
        {health.metrics && (
          <div className="mt-3 pt-3 border-t border-border">
            <p className="text-xs font-semibold text-muted-foreground mb-2">Quick Stats</p>
            <div className="grid grid-cols-2 gap-2 text-xs font-mono">
              {health.metrics.rejection_breakdown && (
                <>
                  <div className="p-2 bg-secondary/30 rounded">
                    <span className="text-muted-foreground">Edge filter:</span>
                    <p className="font-bold">{health.metrics.rejection_breakdown.edge_filter}</p>
                  </div>
                  <div className="p-2 bg-secondary/30 rounded">
                    <span className="text-muted-foreground">Fillable:</span>
                    <p className="font-bold">{health.metrics.rejection_breakdown.fillable_filter}</p>
                  </div>
                </>
              )}
              {health.metrics.gateway_performance && (
                <>
                  <div className="p-2 bg-secondary/30 rounded">
                    <span className="text-muted-foreground">Evaluations:</span>
                    <p className="font-bold">{health.metrics.gateway_performance.venue_pair_checks}</p>
                  </div>
                  <div className="p-2 bg-secondary/30 rounded">
                    <span className="text-muted-foreground">Posted:</span>
                    <p className="font-bold">{health.metrics.gateway_performance.passed_dedupe_gate}</p>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}