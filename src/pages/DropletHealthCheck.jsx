import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { toast } from 'sonner';
import { 
  CheckCircle2, 
  XCircle, 
  AlertTriangle, 
  RefreshCw,
  Wifi,
  Signal,
  Clock,
  Play,
  RotateCcw,
  Settings,
  Upload,
  Square
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
  const [actionLoading, setActionLoading] = useState(null); // track which button is loading

  const runAction = async (fnName, label) => {
    setActionLoading(fnName);
    try {
      const res = await base44.functions.invoke(fnName, {});
      toast.success(`${label}: ${res.data?.status || res.data?.message || 'Done'}`);
      setTimeout(checkHealth, 2000); // refresh health after action
    } catch (e) {
      toast.error(`${label} failed: ${e.message}`);
    } finally {
      setActionLoading(null);
    }
  };

  const checkHealth = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await base44.functions.invoke('dropletHealth', {});
      setHealth(res.data);
      setLastCheck(new Date());
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    checkHealth();
    const interval = setInterval(checkHealth, 30000);
    return () => clearInterval(interval);
  }, []);

  if (!health && !error && loading) {
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
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold">Droplet Health</h1>
          <p className="text-muted-foreground mt-1">Monitor and control the arbitrage bot droplet</p>
        </div>
        <Button onClick={checkHealth} disabled={loading} variant="outline">
          <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
          {loading ? 'Checking...' : 'Refresh'}
        </Button>
      </div>

      {/* Bot Action Buttons */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Bot Controls</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Button
              onClick={() => runAction('deployBot', 'Deploy Bot')}
              disabled={!!actionLoading}
              className="bg-primary hover:bg-primary/90"
            >
              {actionLoading === 'deployBot'
                ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                : <Upload className="w-4 h-4 mr-2" />}
              Deploy Bot
            </Button>

            <Button
              onClick={() => runAction('restartDroplet', 'Restart Bot')}
              disabled={!!actionLoading}
              variant="secondary"
            >
              {actionLoading === 'restartDroplet'
                ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                : <RotateCcw className="w-4 h-4 mr-2" />}
              Restart Bot
            </Button>

            <Button
              onClick={() => runAction('setupDroplet', 'Setup Droplet')}
              disabled={!!actionLoading}
              variant="outline"
            >
              {actionLoading === 'setupDroplet'
                ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                : <Settings className="w-4 h-4 mr-2" />}
              Setup Droplet
            </Button>

            <Button
              onClick={() => runAction('testDropletConnection', 'Test Connection')}
              disabled={!!actionLoading}
              variant="outline"
            >
              {actionLoading === 'testDropletConnection'
                ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                : <Wifi className="w-4 h-4 mr-2" />}
              Test Connection
            </Button>
          </div>
          <p className="text-xs text-muted-foreground mt-3 font-mono">
            <b>Deploy Bot</b> — pushes latest bot code + env vars + restarts service. Use after any code change.<br/>
            <b>Restart Bot</b> — restarts the running bot process without re-deploying code.<br/>
            <b>Setup Droplet</b> — writes .env + order-server.mjs for first-time setup.
          </p>
        </CardContent>
      </Card>

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
    </div>
  );
}