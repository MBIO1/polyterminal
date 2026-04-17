import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Trash2, Plus, Check } from 'lucide-react';

export default function ParametersPanel() {
  const [editing, setEditing] = useState(null);
  const [newPreset, setNewPreset] = useState(null);
  const queryClient = useQueryClient();

  const { data: presets = [] } = useQuery({
    queryKey: ['trading-parameters'],
    queryFn: () => base44.entities.TradingParameters.list(),
  });

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.TradingParameters.create(data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['trading-parameters'] }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.TradingParameters.update(id, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['trading-parameters'] }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.TradingParameters.delete(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['trading-parameters'] }),
  });

  const handleActivate = async (preset) => {
    // Deactivate all, then activate selected
    for (const p of presets) {
      if (p.is_active) {
        await updateMutation.mutateAsync({ id: p.id, data: { is_active: false } });
      }
    }
    await updateMutation.mutateAsync({ id: preset.id, data: { is_active: true } });
  };

  const handleSaveNew = async () => {
    if (!newPreset?.name) return;
    await createMutation.mutateAsync(newPreset);
    setNewPreset(null);
  };

  const activePreset = presets.find(p => p.is_active);

  return (
    <div className="space-y-4">
      {/* Active Preset Badge */}
      {activePreset && (
        <Card className="bg-primary/10 border-primary/30 p-3">
          <p className="text-xs text-muted-foreground">Active Configuration</p>
          <p className="text-sm font-mono font-bold text-primary">{activePreset.name}</p>
          <div className="text-xs text-muted-foreground mt-1 grid grid-cols-2 gap-2">
            <span>Edge: {activePreset.edge_threshold}% | Conf: {activePreset.confidence_threshold}</span>
            <span>Size: ${activePreset.default_size_usdc} | Kelly: {activePreset.kelly_fraction}</span>
          </div>
        </Card>
      )}

      {/* Preset List */}
      <div className="space-y-2 max-h-64 overflow-y-auto">
        {presets.map((preset) => (
          <Card key={preset.id} className="p-3 space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1">
                <p className="text-sm font-mono font-bold">{preset.name}</p>
                {preset.description && (
                  <p className="text-xs text-muted-foreground">{preset.description}</p>
                )}
              </div>
              <Button
                size="sm"
                variant={preset.is_active ? 'default' : 'outline'}
                onClick={() => handleActivate(preset)}
                className="gap-1 text-xs"
              >
                {preset.is_active ? <Check className="w-3 h-3" /> : 'Activate'}
              </Button>
            </div>

            {/* Inline edit mode */}
            {editing === preset.id ? (
              <div className="space-y-2 pt-2 border-t border-border/30">
                <ParameterSlider
                  label="Default Size (USDC)"
                  value={preset.default_size_usdc}
                  min={0.1}
                  max={100}
                  step={0.1}
                  onChange={(v) => updateMutation.mutate({ id: preset.id, data: { default_size_usdc: v } })}
                />
                <ParameterSlider
                  label="Edge Threshold (%)"
                  value={preset.edge_threshold}
                  min={1}
                  max={20}
                  step={0.5}
                  onChange={(v) => updateMutation.mutate({ id: preset.id, data: { edge_threshold: v } })}
                />
                <ParameterSlider
                  label="Confidence Threshold"
                  value={preset.confidence_threshold}
                  min={50}
                  max={100}
                  step={1}
                  onChange={(v) => updateMutation.mutate({ id: preset.id, data: { confidence_threshold: v } })}
                />
                <ParameterSlider
                  label="Kelly Fraction"
                  value={preset.kelly_fraction}
                  min={0.1}
                  max={1}
                  step={0.05}
                  onChange={(v) => updateMutation.mutate({ id: preset.id, data: { kelly_fraction: v } })}
                />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setEditing(null)}
                  className="w-full"
                >
                  Done
                </Button>
              </div>
            ) : (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setEditing(preset.id)}
                className="w-full text-xs"
              >
                Edit
              </Button>
            )}

            <Button
              size="sm"
              variant="ghost"
              onClick={() => deleteMutation.mutate(preset.id)}
              className="gap-1 text-xs text-destructive w-full"
            >
              <Trash2 className="w-3 h-3" /> Delete
            </Button>
          </Card>
        ))}
      </div>

      {/* New Preset Form */}
      <Card className="p-3 space-y-2 border-dashed">
        {newPreset ? (
          <div className="space-y-2">
            <Input
              placeholder="Preset name (e.g., Conservative)"
              value={newPreset.name || ''}
              onChange={(e) => setNewPreset({ ...newPreset, name: e.target.value })}
              className="text-xs"
            />
            <Input
              placeholder="Optional description"
              value={newPreset.description || ''}
              onChange={(e) => setNewPreset({ ...newPreset, description: e.target.value })}
              className="text-xs"
            />
            <div className="grid grid-cols-2 gap-2">
              <Input
                type="number"
                placeholder="Default size ($)"
                value={newPreset.default_size_usdc || ''}
                onChange={(e) => setNewPreset({ ...newPreset, default_size_usdc: parseFloat(e.target.value) || 10 })}
                className="text-xs"
              />
              <Input
                type="number"
                placeholder="Edge % min"
                value={newPreset.edge_threshold || ''}
                onChange={(e) => setNewPreset({ ...newPreset, edge_threshold: parseFloat(e.target.value) || 5 })}
                className="text-xs"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Input
                type="number"
                placeholder="Confidence min"
                value={newPreset.confidence_threshold || ''}
                onChange={(e) => setNewPreset({ ...newPreset, confidence_threshold: parseFloat(e.target.value) || 85 })}
                className="text-xs"
              />
              <Input
                type="number"
                placeholder="Kelly fraction"
                min="0.1"
                max="1"
                step="0.05"
                value={newPreset.kelly_fraction || ''}
                onChange={(e) => setNewPreset({ ...newPreset, kelly_fraction: parseFloat(e.target.value) || 0.5 })}
                className="text-xs"
              />
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={handleSaveNew} className="flex-1">
                Save Preset
              </Button>
              <Button size="sm" variant="outline" onClick={() => setNewPreset(null)} className="flex-1">
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setNewPreset({})}
            className="w-full gap-1"
          >
            <Plus className="w-3 h-3" /> New Preset
          </Button>
        )}
      </Card>
    </div>
  );
}

function ParameterSlider({ label, value, min, max, step, onChange }) {
  return (
    <div className="space-y-1">
      <div className="flex justify-between">
        <Label className="text-xs font-mono">{label}</Label>
        <span className="text-xs font-bold text-primary">{value.toFixed(2)}</span>
      </div>
      <Slider
        value={[value]}
        onValueChange={([v]) => onChange(v)}
        min={min}
        max={max}
        step={step}
        className="w-full"
      />
    </div>
  );
}