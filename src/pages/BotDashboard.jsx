import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';
import PriceTickerBar from '@/components/bot/PriceTickerBar';
import KillSwitch from '@/components/bot/KillSwitch';
import OpportunityScanner from '@/components/bot/OpportunityScanner';
import TradeLog from '@/components/bot/TradeLog';
import BotControls from '@/components/bot/BotControls';
import ConfigPanel from '@/components/bot/ConfigPanel';
import PerformanceMetrics from '@/components/bot/PerformanceMetrics';
import ChecklistPanel from '@/components/bot/ChecklistPanel';
import { calcStats, calcDailyDrawdown, halfKelly, detectOpportunity } from '@/lib/botEngine';
import {
  startPriceSimulator,
  stopPriceSimulator,
  getPolymarketContracts,
} from '@/lib/priceSimulator';

const DEFAULT_CONFIG = {
  paper_trading: true,
  live_flag_1: false,
  live_flag_2: false,
  live_flag_3: false,
  edge_threshold: 5,
  lag_threshold: 3,
  max_position_pct: 8,
  confidence_threshold: 85,
  kelly_fraction: 0.5,
  daily_drawdown_halt: 20,
  total_drawdown_kill: 40,
  min_liquidity: 50000,
  starting_balance: 1000,
  kill_switch_active: false,
  bot_running: false,
};

export default function BotDashboard() {
  const queryClient = useQueryClient();
  const [prices, setPrices] = useState({ btc: { price: 97500, change: 0 }, eth: { price: 3200, change: 0 } });
  const [opportunities, setOpportunities] = useState([]);
  const [localConfig, setLocalConfig] = useState(DEFAULT_CONFIG);
  const [running, setRunning] = useState(false);
  const scanIntervalRef = useRef(null);

  const { data: configs = [] } = useQuery({
    queryKey: ['bot-config'],
    queryFn: () => base44.entities.BotConfig.list(),
  });

  const { data: trades = [] } = useQuery({
    queryKey: ['bot-trades'],
    queryFn: () => base44.entities.BotTrade.list('-created_date'),
  });

  const config = configs[0] || localConfig;
  const startingBalance = config.starting_balance || 1000;

  const stats = calcStats(trades);
  const { drawdown: dailyDrawdown, todayPnl } = calcDailyDrawdown(trades, startingBalance);
  const totalPnl = trades.reduce((s, t) => s + (t.pnl_usdc || 0), 0);
  const portfolioValue = startingBalance + totalPnl;
  const totalDrawdown = totalPnl < 0 ? (Math.abs(totalPnl) / startingBalance) * 100 : 0;

  const isHalted =
    config.kill_switch_active ||
    dailyDrawdown >= (config.daily_drawdown_halt || 20) ||
    totalDrawdown >= (config.total_drawdown_kill || 40);

  const saveConfig = useMutation({
    mutationFn: async (updates) => {
      if (configs.length > 0) {
        return base44.entities.BotConfig.update(configs[0].id, updates);
      }
      return base44.entities.BotConfig.create({ ...DEFAULT_CONFIG, ...updates });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['bot-config'] }),
  });

  const tradeMutation = useMutation({
    mutationFn: (data) => base44.entities.BotTrade.create(data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['bot-trades'] }),
  });

  const drawdownMutation = useMutation({
    mutationFn: (data) => base44.entities.DrawdownLog.create(data),
  });

  const handleConfigUpdate = (updates) => {
    setLocalConfig(prev => ({ ...prev, ...updates }));
    saveConfig.mutate(updates);
  };

  const handlePriceUpdate = useCallback((update) => {
    setPrices({ btc: update.btc, eth: update.eth });
  }, []);

  useEffect(() => {
    startPriceSimulator(handlePriceUpdate);
    return () => stopPriceSimulator(handlePriceUpdate);
  }, [handlePriceUpdate]);

  // Opportunity scanner loop
  useEffect(() => {
    if (!running || isHalted) {
      setOpportunities([]);
      if (scanIntervalRef.current) clearInterval(scanIntervalRef.current);
      return;
    }

    const scan = () => {
      const btcP = prices.btc?.price || 97500;
      const ethP = prices.eth?.price || 3200;
      const btcPr = btcP * (1 - (prices.btc?.change || 0) / 100);
      const ethPr = ethP * (1 - (prices.eth?.change || 0) / 100);
      const contracts = getPolymarketContracts(btcP, ethP, btcPr, ethPr);

      const opps = contracts
        .filter(c => c.lag_pct >= (config.lag_threshold || 3))
        .map(c => {
          const opp = detectOpportunity(
            c.polymarket_price,
            c.cex_implied_prob,
            config.lag_threshold || 3,
            config.edge_threshold || 5
          );
          if (!opp) return null;
          const kellySize = halfKelly(
            opp.edge_pct / 100,
            c.polymarket_price,
            portfolioValue,
            (config.max_position_pct || 8) / 100
          );
          return { ...c, ...opp, kelly_size_usdc: kellySize, btc_price: btcP, eth_price: ethP };
        })
        .filter(Boolean)
        .sort((a, b) => b.edge_pct - a.edge_pct);

      setOpportunities(opps);
    };

    scan();
    scanIntervalRef.current = setInterval(scan, 2000);
    return () => clearInterval(scanIntervalRef.current);
  }, [running, isHalted, prices, config, portfolioValue]);

  const handleExecute = async (opp) => {
    if (isHalted) return;
    const confThresh = config.confidence_threshold || 85;
    const edgeThresh = config.edge_threshold || 5;

    if (opp.confidence_score < confThresh) {
      toast.error(`Confidence ${opp.confidence_score.toFixed(0)}% < ${confThresh}% threshold`);
      return;
    }
    if (opp.edge_pct < edgeThresh) {
      toast.error(`Edge ${opp.edge_pct.toFixed(1)}% < ${edgeThresh}% threshold`);
      return;
    }

    const isPaper = config.paper_trading !== false || !(config.live_flag_1 && config.live_flag_2 && config.live_flag_3);
    const winProb = opp.cex_implied_prob;
    const outcome = Math.random() < winProb ? 'win' : 'loss';
    const pnl = outcome === 'win'
      ? opp.kelly_size_usdc * ((1 - opp.polymarket_price) / opp.polymarket_price)
      : -opp.kelly_size_usdc;

    await tradeMutation.mutateAsync({
      market_title: opp.market_title || opp.title,
      asset: opp.asset,
      contract_type: opp.contract_type,
      side: opp.recommended_side,
      entry_price: opp.polymarket_price,
      exit_price: outcome === 'win' ? 1.0 : 0.0,
      shares: Math.floor(opp.kelly_size_usdc / opp.polymarket_price),
      size_usdc: opp.kelly_size_usdc,
      edge_at_entry: opp.edge_pct,
      confidence_at_entry: opp.confidence_score,
      kelly_fraction_used: config.kelly_fraction || 0.5,
      pnl_usdc: Number(pnl.toFixed(4)),
      outcome,
      mode: isPaper ? 'paper' : 'live',
      btc_price: prices.btc?.price,
      eth_price: prices.eth?.price,
      telegram_sent: false,
    });

    toast.success(
      `${isPaper ? '📄 Paper' : '💰 Live'} trade · ${opp.asset} ${opp.contract_type?.replace('_', ' ')} ${opp.recommended_side?.toUpperCase()} · ${outcome === 'win' ? `+$${pnl.toFixed(2)}` : `-$${Math.abs(pnl).toFixed(2)}`}`,
      { duration: 5000 }
    );

    const newDailyPnl = todayPnl + pnl;
    const newDailyDD = Math.abs(Math.min(0, newDailyPnl)) / startingBalance * 100;
    if (newDailyDD >= (config.daily_drawdown_halt || 20)) {
      toast.error('⚠️ Daily drawdown limit hit — trading halted!', { duration: 10000 });
      await drawdownMutation.mutateAsync({
        event_type: 'daily_halt',
        drawdown_pct: newDailyDD,
        portfolio_value: portfolioValue + pnl,
        triggered_at_pct: config.daily_drawdown_halt || 20,
        message: `Daily drawdown ${newDailyDD.toFixed(1)}% exceeded limit`,
      });
    }
  };

  const handleKillActivate = () => {
    handleConfigUpdate({ kill_switch_active: true });
    setRunning(false);
    drawdownMutation.mutate({
      event_type: 'kill_switch',
      drawdown_pct: totalDrawdown,
      portfolio_value: portfolioValue,
      triggered_at_pct: config.total_drawdown_kill || 40,
      message: 'Manual kill switch activated',
    });
    toast.error('🛑 Kill switch activated — all trading halted');
  };

  const handleKillReset = () => {
    handleConfigUpdate({ kill_switch_active: false });
    toast.success('✅ Kill switch reset');
  };

  const handleToggleRun = () => {
    if (isHalted && !running) return;
    const next = !running;
    setRunning(next);
    toast.info(next ? '▶️ Bot started — scanning BTC/ETH contracts' : '⏸ Bot paused');
  };

  const isPaper = config.paper_trading !== false || !(config.live_flag_1 && config.live_flag_2 && config.live_flag_3);

  return (
    <div className="flex flex-col min-h-screen">
      <PriceTickerBar btc={prices.btc} eth={prices.eth} connected={false} />

      <div className="flex-1 p-4 md:p-5 max-w-[1600px] mx-auto w-full">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
          <div>
            <div className="flex flex-wrap items-center gap-2 mb-1">
              <h1 className="text-xl font-bold text-foreground font-mono">Polymarket Arb Bot</h1>
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-bold ${isPaper ? 'bg-chart-4/10 text-chart-4' : 'bg-destructive/20 text-destructive'}`}>
                {isPaper ? '📄 PAPER TRADING' : '💰 LIVE TRADING'}
              </span>
              {isHalted && (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-destructive/20 text-destructive animate-pulse">
                  ⛔ HALTED
                </span>
              )}
              {running && !isHalted && (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-accent/10 text-accent">
                  ▶ RUNNING
                </span>
              )}
            </div>
            <p className="text-[11px] text-muted-foreground font-mono">
              BTC/ETH 5-min &amp; 15-min contracts · Half-Kelly sizing · Edge &gt; {config.edge_threshold || 5}% · Conf &gt; {config.confidence_threshold || 85}% · Max pos {config.max_position_pct || 8}%
            </p>
          </div>
          <div className="flex items-center gap-4 text-sm font-mono">
            <div>
              <span className="text-muted-foreground text-xs">Portfolio</span>
              <p className="text-foreground font-bold">${portfolioValue.toFixed(2)}</p>
            </div>
            <div>
              <span className="text-muted-foreground text-xs">Total P&L</span>
              <p className={`font-bold ${totalPnl >= 0 ? 'text-accent' : 'text-destructive'}`}>
                {totalPnl >= 0 ? '+' : ''}${totalPnl.toFixed(2)}
              </p>
            </div>
          </div>
        </div>

        {/* Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">

          {/* LEFT */}
          <div className="lg:col-span-3 space-y-4">
            <BotControls config={config} onUpdate={handleConfigUpdate} running={running} onToggleRun={handleToggleRun} halted={isHalted} />
            <KillSwitch
              active={config.kill_switch_active}
              dailyDrawdown={dailyDrawdown}
              totalDrawdown={totalDrawdown}
              dailyHaltPct={config.daily_drawdown_halt || 20}
              killPct={config.total_drawdown_kill || 40}
              onActivate={handleKillActivate}
              onReset={handleKillReset}
            />
            <ConfigPanel config={config} onUpdate={handleConfigUpdate} />
          </div>

          {/* CENTER */}
          <div className="lg:col-span-6 space-y-4">
            {/* Scanner */}
            <div className="rounded-xl border border-border bg-card p-5">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <div className={`w-2 h-2 rounded-full ${running && !isHalted ? 'bg-accent animate-pulse' : 'bg-muted-foreground'}`} />
                  <h3 className="text-sm font-semibold text-foreground">Live Opportunity Scanner</h3>
                </div>
                <span className="text-[10px] font-mono text-muted-foreground">Lag ≥ {config.lag_threshold || 3}pp</span>
              </div>
              {!running ? (
                <div className="text-center py-8 text-muted-foreground">
                  <p className="text-sm font-mono">Bot is paused</p>
                  <p className="text-xs mt-1">Start bot to scan BTC/ETH 5-min &amp; 15-min contracts</p>
                </div>
              ) : isHalted ? (
                <div className="text-center py-8 text-destructive/70">
                  <p className="text-sm font-mono">⛔ Trading halted — drawdown limit reached</p>
                </div>
              ) : (
                <OpportunityScanner
                  opportunities={opportunities}
                  onExecute={handleExecute}
                  botRunning={running && !isHalted}
                  portfolioValue={portfolioValue}
                  maxPosPct={(config.max_position_pct || 8) / 100}
                />
              )}
            </div>

            {/* Contract Monitor */}
            <div className="rounded-xl border border-border bg-card p-5">
              <h3 className="text-sm font-semibold text-foreground mb-4">Contract Monitor — Polymarket CLOB vs CEX</h3>
              <ContractMonitor prices={prices} config={config} />
            </div>

            {/* Trade log */}
            <div className="rounded-xl border border-border bg-card p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-foreground">Last 10 Trades (SQLite Log)</h3>
                <span className="text-xs font-mono text-muted-foreground">{trades.length} total recorded</span>
              </div>
              <TradeLog trades={trades} limit={10} />
            </div>
          </div>

          {/* RIGHT */}
          <div className="lg:col-span-3 space-y-4">
            {/* P&L */}
            <div className="rounded-xl border border-border bg-card p-5 space-y-3">
              <h3 className="text-xs font-mono font-medium text-muted-foreground uppercase tracking-wider">P&L Summary</h3>
              {[
                { label: 'Portfolio Value', value: `$${portfolioValue.toFixed(2)}`, color: 'text-foreground' },
                { label: 'Total P&L', value: `${totalPnl >= 0 ? '+' : ''}$${totalPnl.toFixed(2)}`, color: totalPnl >= 0 ? 'text-accent' : 'text-destructive' },
                { label: "Today's P&L", value: `${todayPnl >= 0 ? '+' : ''}$${todayPnl.toFixed(2)}`, color: todayPnl >= 0 ? 'text-accent' : 'text-destructive' },
                { label: 'Daily Drawdown', value: `${dailyDrawdown.toFixed(1)}%`, color: dailyDrawdown > 15 ? 'text-destructive' : dailyDrawdown > 10 ? 'text-chart-4' : 'text-foreground' },
                { label: 'Total Drawdown', value: `${totalDrawdown.toFixed(1)}%`, color: totalDrawdown > 30 ? 'text-destructive' : 'text-foreground' },
                { label: 'Pending Trades', value: trades.filter(t => t.outcome === 'pending').length, color: 'text-primary' },
              ].map(item => (
                <div key={item.label} className="flex justify-between items-center py-1.5 border-b border-border/30 last:border-0">
                  <span className="text-xs text-muted-foreground">{item.label}</span>
                  <span className={`text-sm font-mono font-bold ${item.color}`}>{item.value}</span>
                </div>
              ))}
            </div>

            <PerformanceMetrics stats={stats} portfolioValue={portfolioValue} startingBalance={startingBalance} paperTrades={trades} />
            <ChecklistPanel />
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Contract Monitor ───────────────────────────────────────────────────────────
function ContractMonitor({ prices, config }) {
  const btcP = prices.btc?.price || 97500;
  const ethP = prices.eth?.price || 3200;
  const btcPr = btcP * (1 - (prices.btc?.change || 0) / 100);
  const ethPr = ethP * (1 - (prices.eth?.change || 0) / 100);
  const contracts = getPolymarketContracts(btcP, ethP, btcPr, ethPr);
  const lagThresh = config?.lag_threshold || 3;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[11px] font-mono">
        <thead>
          <tr className="border-b border-border text-muted-foreground">
            <th className="pb-2 text-left font-medium">Contract</th>
            <th className="pb-2 text-right font-medium">Poly</th>
            <th className="pb-2 text-right font-medium">CEX Impl.</th>
            <th className="pb-2 text-right font-medium">Lag</th>
            <th className="pb-2 text-right font-medium">Signal</th>
          </tr>
        </thead>
        <tbody>
          {contracts.map(c => {
            const isArb = c.lag_pct >= lagThresh;
            return (
              <tr key={c.id} className={`border-b border-border/20 last:border-0 transition-colors ${isArb ? 'bg-accent/5' : ''}`}>
                <td className="py-1.5 text-left">
                  <span className={`px-1 py-0.5 rounded text-[9px] font-bold mr-1 ${c.asset === 'BTC' ? 'bg-chart-4/10 text-chart-4' : 'bg-primary/10 text-primary'}`}>{c.asset}</span>
                  {c.type.replace('_', ' ')}
                </td>
                <td className="py-1.5 text-right">{Math.round(c.polymarket_price * 100)}¢</td>
                <td className="py-1.5 text-right">{Math.round(c.cex_implied_prob * 100)}¢</td>
                <td className={`py-1.5 text-right font-bold ${isArb ? 'text-accent' : 'text-muted-foreground'}`}>
                  {c.lag_pct.toFixed(1)}pp
                </td>
                <td className="py-1.5 text-right">
                  {isArb ? (
                    <span className="text-accent font-bold">BUY {c.cex_implied_prob > c.polymarket_price ? 'YES' : 'NO'}</span>
                  ) : (
                    <span className="text-muted-foreground/40">—</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}