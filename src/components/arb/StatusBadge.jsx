import React from 'react';

const map = {
  // Trade / Position
  Open: 'bg-primary/10 text-primary border-primary/30',
  Closed: 'bg-muted text-muted-foreground border-border',
  Planned: 'bg-chart-4/10 text-chart-4 border-chart-4/30',
  Pending: 'bg-chart-4/10 text-chart-4 border-chart-4/30',
  Closing: 'bg-chart-4/10 text-chart-4 border-chart-4/30',
  Completed: 'bg-accent/10 text-accent border-accent/30',
  Cancelled: 'bg-muted text-muted-foreground border-border',
  Failed: 'bg-destructive/10 text-destructive border-destructive/30',
  Error: 'bg-destructive/10 text-destructive border-destructive/30',
  Monitoring: 'bg-chart-5/10 text-chart-5 border-chart-5/30',
  // Severity
  Low: 'bg-muted text-muted-foreground border-border',
  Medium: 'bg-chart-4/10 text-chart-4 border-chart-4/30',
  High: 'bg-destructive/10 text-destructive border-destructive/30',
  Critical: 'bg-destructive text-destructive-foreground border-destructive',
};

export default function StatusBadge({ status }) {
  if (!status) return <span className="text-muted-foreground">—</span>;
  const cls = map[status] || 'bg-secondary text-foreground border-border';
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-md border text-[10px] font-mono font-medium tracking-wide uppercase ${cls}`}>
      {status}
    </span>
  );
}