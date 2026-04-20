import React from 'react';

export default function Section({ title, subtitle, action, children, className = '' }) {
  return (
    <section className={`rounded-xl border border-border bg-card ${className}`}>
      {(title || action) && (
        <header className="flex items-start justify-between gap-4 px-5 py-4 border-b border-border">
          <div>
            {title && <h2 className="text-sm font-semibold text-foreground tracking-tight">{title}</h2>}
            {subtitle && <p className="text-xs text-muted-foreground mt-0.5 font-mono">{subtitle}</p>}
          </div>
          {action}
        </header>
      )}
      <div className="p-5">{children}</div>
    </section>
  );
}