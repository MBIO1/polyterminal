import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Play, Square, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

export default function BotControls({ config, onUpdated }) {
  const [loading, setLoading] = useState(null); // 'start' | 'stop'

  const isRunning = config == null ? true : config?.bot_running && !config?.kill_switch_active;

  const trigger = async (action) => {
    setLoading(action);
    try {
      await base44.functions.invoke('startStopBot', { action });
      toast.success(action === 'start' ? 'Bot started' : 'Bot stopped');
      if (onUpdated) onUpdated();
    } catch (e) {
      toast.error(`Failed: ${e.message}`);
    } finally {
      setLoading(null);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <Button
        size="sm"
        disabled={!!loading || isRunning || config == null}
        onClick={() => trigger('start')}
        className="bg-green-600 hover:bg-green-700 text-white"
      >
        {loading === 'start' ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Play className="w-4 h-4 mr-1" />}
        Start Bot
      </Button>
      <Button
        size="sm"
        variant="destructive"
        disabled={!!loading || !isRunning || config == null}
        onClick={() => trigger('stop')}
      >
        {loading === 'stop' ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Square className="w-4 h-4 mr-1" />}
        Stop Bot
      </Button>
      <span className={`text-xs font-mono ml-1 ${isRunning ? 'text-green-400' : 'text-muted-foreground'}`}>
        {config?.kill_switch_active ? '🔴 Kill Switch' : isRunning ? '🟢 Running' : '⚪ Stopped'}
      </span>
    </div>
  );
}