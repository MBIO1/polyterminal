import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';
import { Save, Bell, AlertTriangle, Mail, MessageSquare } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';

const THRESHOLD_GROUPS = [
  {
    title: 'Strategy Drawdown Alerts',
    icon: AlertTriangle,
    fields: [
      { key: 'max_strategy_drawdown_pct', label: 'Max Strategy Drawdown (%)', step: 0.5, suffix: '%',
        description: 'Alert when any strategy drawdown exceeds this % of its allocated capital' },
      { key: 'max_daily_loss_usd', label: 'Max Daily Loss (USD)', step: 50, prefix: '$',
        description: 'Alert when total daily loss exceeds this amount' },
    ],
  },
  {
    title: 'Signal Failure Notifications',
    icon: Bell,
    fields: [
      { key: 'signal_failure_rate_pct', label: 'Signal Rejection Rate Threshold (%)', step: 5, suffix: '%',
        description: 'Alert when rejection rate in a heartbeat window exceeds this %' },
      { key: 'min_signal_edge_alert_bps', label: 'Minimum Edge Alert (bps)', step: 1, suffix: ' bps',
        description: 'Alert when best edge seen consistently drops below this level' },
      { key: 'low_edge_consecutive_heartbeats', label: 'Consecutive Low-Edge Heartbeats', step: 1,
        description: 'Number of consecutive low-edge heartbeats before triggering an alert' },
    ],
  },
  {
    title: 'System Health Thresholds',
    icon: AlertTriangle,
    fields: [
      { key: 'heartbeat_stale_minutes', label: 'Heartbeat Stale Timeout (minutes)', step: 1, suffix: ' min',
        description: 'Minutes without a heartbeat before the bot is flagged as offline' },
    ],
  },
];

const TG_TOGGLES = [
  { key: 'tg_trade_open_close', label: 'Trade Open / Close', description: 'Notify when a trade is opened or closed' },
  { key: 'tg_trade_exceptions', label: 'Trade Exceptions', description: 'Notify on Error or Cancelled trade states' },
  { key: 'tg_trade_lifecycle', label: 'All Trade Lifecycle', description: 'Notify on every trade status transition' },
  { key: 'tg_droplet_offline', label: 'Droplet Offline / Recovery', description: 'Notify when the droplet goes offline or recovers' },
  { key: 'tg_signal_flow_blocked', label: 'Signal Flow Blocked', description: 'Notify when no signals are reaching Base44' },
  { key: 'tg_heartbeat_alerts', label: 'Heartbeat Anomalies', description: 'Notify on zero evaluations or high fillable rejection rate' },
  { key: 'tg_margin_breach', label: 'Margin Breach', description: 'Notify on margin utilization breach' },
  { key: 'tg_funding_anomaly', label: 'Funding Anomaly', description: 'Notify on funding rate anomalies' },
  { key: 'tg_transfer_stuck', label: 'Transfer Stuck', description: 'Notify when a transfer is stuck past expected arrival' },
  { key: 'tg_daily_summary', label: 'Daily P&L Summary', description: 'Send a daily P&L summary report' },
];

const DEFAULTS = {
  max_strategy_drawdown_pct: 5,
  max_daily_loss_usd: 500,
  signal_failure_rate_pct: 30,
  min_signal_edge_alert_bps: 20,
  low_edge_consecutive_heartbeats: 5,
  heartbeat_stale_minutes: 3,
  email_alerts_enabled: false,
  alert_email: '',
  tg_trade_open_close: true,
  tg_trade_exceptions: true,
  tg_trade_lifecycle: true,
  tg_droplet_offline: true,
  tg_signal_flow_blocked: true,
  tg_heartbeat_alerts: true,
  tg_margin_breach: true,
  tg_funding_anomaly: true,
  tg_transfer_stuck: true,
  tg_daily_summary: true,
};

export default function AlertSettings() {
  const qc = useQueryClient();

  const { data: thresholds, isLoading } = useQuery({
    queryKey: ['alert-thresholds'],
    queryFn: async () => (await base44.entities.AlertThreshold.list('-created_date', 1))[0],
  });

  const [f, setF] = useState(DEFAULTS);

  useEffect(() => { if (thresholds) setF({ ...DEFAULTS, ...thresholds }); }, [thresholds]);

  const save = useMutation({
    mutationFn: async (data) => {
      if (thresholds?.id) return base44.entities.AlertThreshold.update(thresholds.id, data);
      return base44.entities.AlertThreshold.create(data);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['alert-thresholds'] }); toast.success('Alert settings saved'); },
    onError: (e) => toast.error(e.message),
  });

  const set = (k, v) => setF(prev => ({ ...prev, [k]: v }));

  const allTgOn = TG_TOGGLES.every(t => f[t.key] !== false);
  const toggleAll = (v) => {
    const updates = {};
    TG_TOGGLES.forEach(t => { updates[t.key] = v; });
    setF(prev => ({ ...prev, ...updates }));
  };

  if (isLoading) return <div className="p-8 text-center text-muted-foreground font-mono text-sm">Loading…</div>;

  return (
    <div className="p-4 md:p-6 lg:p-8 max-w-[900px] mx-auto space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Bell className="w-6 h-6 text-primary" />
            Alert Settings
          </h1>
          <p className="text-sm text-muted-foreground mt-1 font-mono">
            Configure when and how you get notified about trading issues
          </p>
        </div>
        <Button onClick={() => save.mutate(f)} disabled={save.isPending}>
          <Save className="w-4 h-4 mr-2" />
          {save.isPending ? 'Saving…' : 'Save Settings'}
        </Button>
      </div>

      {/* Telegram Notification Toggles */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-sm flex items-center gap-2">
                <MessageSquare className="w-4 h-4 text-primary" />
                Telegram Notifications
              </CardTitle>
              <CardDescription className="mt-1">Choose which events trigger Telegram alerts</CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground font-mono">All alerts</span>
              <Switch checked={allTgOn} onCheckedChange={toggleAll} />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {TG_TOGGLES.map(({ key, label, description }) => (
              <div key={key} className="flex items-center justify-between p-3 rounded-lg border border-border bg-secondary/30">
                <div>
                  <p className="text-sm font-medium">{label}</p>
                  <p className="text-xs text-muted-foreground font-mono">{description}</p>
                </div>
                <Switch checked={f[key] !== false} onCheckedChange={v => set(key, v)} />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Email Alerts */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <Mail className="w-4 h-4 text-muted-foreground" />
            Email Alerts
          </CardTitle>
          <CardDescription>Send alert emails to a specified address</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between p-3 rounded-lg border border-border bg-secondary/30">
            <div>
              <p className="text-sm font-medium">Email Alerts Enabled</p>
              <p className="text-xs text-muted-foreground font-mono">Send notifications via email</p>
            </div>
            <Switch checked={!!f.email_alerts_enabled} onCheckedChange={v => set('email_alerts_enabled', v)} />
          </div>
          {f.email_alerts_enabled && (
            <div>
              <Label className="text-xs font-mono text-muted-foreground">Alert Email Address</Label>
              <Input
                type="email"
                value={f.alert_email || ''}
                onChange={e => set('alert_email', e.target.value)}
                placeholder="alerts@example.com"
                className="font-mono mt-1"
              />
            </div>
          )}
        </CardContent>
      </Card>

      {/* Threshold Groups */}
      {THRESHOLD_GROUPS.map(group => {
        const Icon = group.icon;
        return (
          <Card key={group.title}>
            <CardHeader>
              <CardTitle className="text-sm flex items-center gap-2">
                <Icon className="w-4 h-4 text-primary" />
                {group.title}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {group.fields.map(({ key, label, step, description, prefix, suffix }) => (
                  <div key={key} className="space-y-1">
                    <Label className="text-xs font-mono text-muted-foreground">{label}</Label>
                    <div className="relative">
                      {prefix && (
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground font-mono">{prefix}</span>
                      )}
                      <Input
                        type="number"
                        step={step}
                        value={f[key] ?? ''}
                        onChange={e => set(key, e.target.value === '' ? '' : Number(e.target.value))}
                        className={`font-mono ${prefix ? 'pl-6' : ''}`}
                      />
                      {suffix && (
                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground font-mono">{suffix}</span>
                      )}
                    </div>
                    {description && (
                      <p className="text-[11px] text-muted-foreground font-mono leading-tight">{description}</p>
                    )}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}