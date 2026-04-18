import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Activity, AlertTriangle, CheckCircle, XCircle, Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

const StatusBadge = ({ status }) => {
  const config = {
    OK: { icon: CheckCircle, color: 'text-accent', bg: 'bg-accent/10', label: 'OK' },
    FAILED: { icon: XCircle, color: 'text-destructive', bg: 'bg-destructive/10', label: 'Failed' },
    PARTIAL: { icon: AlertTriangle, color: 'text-chart-4', bg: 'bg-chart-4/10', label: 'Partial' },
    SKIPPED: { icon: Activity, color: 'text-muted-foreground', bg: 'bg-muted/20', label: 'Skipped' },
  }[status] || { icon: Activity, color: 'text-muted-foreground', bg: 'bg-muted/20', label: status };

  const Icon = config.icon;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-1 rounded text-[10px] font-mono font-bold ${config.bg} ${config.color}`}>
      <Icon className="w-3 h-3" />
      {config.label}
    </span>
  );
};

const OverallStatusBadge = ({ status }) => {
  const colors = {
    HEALTHY: { bg: 'bg-accent/10', text: 'text-accent', label: '✅ HEALTHY' },
    DEGRADED: { bg: 'bg-chart-4/10', text: 'text-chart-4', label: '⚠️ DEGRADED' },
    UNHEALTHY: { bg: 'bg-destructive/10', text: 'text-destructive', label: '🔴 UNHEALTHY' },
  }[status] || { bg: 'bg-muted/20', text: 'text-muted-foreground', label: '?' };

  return (
    <div className={`rounded-lg border border-border p-3 ${colors.bg}`}>
      <span className={`text-sm font-mono font-bold ${colors.text}`}>{colors.label}</span>
    </div>
  );
};

export default function HealthCheckPanel() {
  const [isExpanded, setIsExpanded] = useState(false);

  const { data: health, isLoading, refetch } = useQuery({
    queryKey: ['system-health'],
    queryFn: () => base44.functions.invoke('systemHealthCheck', {}).then(res => res.data),
    refetchInterval: 60000, // Auto-refresh every 60 seconds
  });

  const handleManualRefresh = async () => {
    toast.loading('Running health check...');
    await refetch();
  };

  if (!health && !isLoading) {
    return null; // Hide if no data
  }

  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-primary" />
          <h3 className="text-xs font-semibold text-foreground uppercase tracking-wider">System Health</h3>
        </div>
        <div className="flex items-center gap-2">
          {isLoading && <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />}
          <Button
            onClick={handleManualRefresh}
            size="sm"
            variant="ghost"
            className="px-2 h-6 text-[10px]"
            disabled={isLoading}
          >
            <RefreshCw className="w-3 h-3" />
          </Button>
        </div>
      </div>

      {health && (
        <>
          {/* Overall status */}
          <OverallStatusBadge status={health.overallStatus} />

          {/* Quick stats */}
          <div className="grid grid-cols-2 gap-2 text-[10px] text-muted-foreground font-mono">
            <div>
              <span className="font-bold text-foreground">{health.failedChecks.length}</span> checks failed
            </div>
            <div>Last check: {new Date(health.timestamp).toLocaleTimeString()}</div>
          </div>

          {/* Failed checks alert */}
          {health.failedChecks.length > 0 && (
            <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-2.5 space-y-1">
              <p className="text-[10px] font-semibold text-destructive">Issues detected:</p>
              {health.failedChecks.slice(0, 3).map((check, i) => (
                <p key={i} className="text-[9px] text-destructive/80">• {check}</p>
              ))}
              {health.failedChecks.length > 3 && (
                <p className="text-[9px] text-destructive/60">... and {health.failedChecks.length - 3} more</p>
              )}
            </div>
          )}

          {/* Expandable details */}
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="w-full text-left text-[10px] font-mono text-primary hover:underline"
          >
            {isExpanded ? '▼' : '▶'} View all checks ({Object.keys(health.checks).length})
          </button>

          {isExpanded && (
            <div className="space-y-2 border-t border-border pt-3">
              {Object.entries(health.checks).map(([name, check]) => (
                <div key={name} className="rounded-lg bg-secondary/20 p-2.5 space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-mono text-foreground font-bold">{name.replace(/_/g, ' ')}</span>
                    <StatusBadge status={check.status} />
                  </div>
                  {check.details && (
                    <div className="text-[9px] text-muted-foreground space-y-0.5">
                      {Object.entries(check.details).map(([k, v]) => (
                        <div key={k}>
                          <span className="font-mono">{k}:</span> {Array.isArray(v) ? v.join(', ') : String(v)}
                        </div>
                      ))}
                    </div>
                  )}
                  {check.error && <p className="text-[9px] text-destructive font-mono">{check.error}</p>}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}