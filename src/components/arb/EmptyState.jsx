import React from 'react';
import { Inbox } from 'lucide-react';

export default function EmptyState({ title = 'No data', subtitle, icon: Icon = Inbox }) {
  return (
    <div className="flex flex-col items-center justify-center py-10 text-center">
      <div className="w-10 h-10 rounded-full bg-secondary flex items-center justify-center mb-3">
        <Icon className="w-5 h-5 text-muted-foreground" />
      </div>
      <p className="text-sm font-medium text-foreground">{title}</p>
      {subtitle && <p className="text-xs text-muted-foreground mt-1 font-mono max-w-xs">{subtitle}</p>}
    </div>
  );
}