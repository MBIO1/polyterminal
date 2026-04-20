import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';
import PriceTickerBar from '@/components/bot/PriceTickerBar';
import OpportunityScanner from '@/components/bot/OpportunityScanner';
import TradeLog from '@/components/bot/TradeLog';
import BotControls from '@/components/bot/BotControls';
import ConfigPanel from '@/components/bot/ConfigPanel';
import PerformanceMetrics from '@/components/bot/PerformanceMetrics';
import ChecklistPanel from '@/components/bot/ChecklistPanel';
import BacktestPanel from '@/components/bot/BacktestPanel';
import RiskManagementPanel from '@/components/bot/RiskManagementPanel';
import { calcStats, calcDailyDrawdown } from '@/lib/botEngine';
import {
  startPriceSimulator,
  stopPriceSimulator,
  getPolymarketContracts } from
'@/lib/priceSimulator';

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
  max_daily_loss_pct: 10,
  max_open_positions: 5,
  auto_halt_24h: true,
  halt_until_ts: 0
};

export default function BotDashboard() {
  const queryClient = useQueryClient();
  const [prices, setPrices] = useState({ btc: { price: 97500, change: 0, live: false }, eth: { price: 3200, change: 0 } });
  const [opportunities, setOpportunities] = useState([]);
  const [localConfig, setLocalConfig] = useState(DEFAULT_CONFIG);

  // Bot running state is sourced from DB (bot_running field) so it persists across page navigation
  const { data: configs = [], isSuccess: configLoaded } = useQuery({
    queryKey: ['bot-config'],
    queryFn: () => base44.entities.BotConfig.list(),
    refetchInterval: 10000 // poll every 10s to pick up server-side halt updates
  });

  const { data: trades = [] } = useQuery({
    queryKey: ['bot-trades'],
    queryFn: () => base44.entities.BotTrade.list('-created_date'),
    refetchInterval: 15000 // auto-refresh to show server-side trades
  });

  const config = configs[0] || localConfig;
  const startingBalance = config.starting_balance || 1000;

  // running = sourced from DB so it survives page navigation / window close
  const running = config.bot_running || false;

  const stats = calcStats(trades);
  const { drawdown: dailyDrawdown, todayPnl } = calcDailyDrawdown(trades, startingBalance);
  const totalPnl = trades.reduce((s, t) => s + (t.pnl_usdc || 0), 0);
  const portfolioValue = startingBalance + totalPnl;
  const totalDrawdown = totalPnl < 0 ? Math.abs(totalPnl) / startingBalance * 100 : 0;

  const openTradeCount = trades.filter((t) => t.outcome === 'pending').length;
  const haltUntilTs = config.halt_until_ts || 0;
  const is24hHalted = haltUntilTs > Date.now();
  const dailyLossBreached = dailyDrawdown >= (config.max_daily_loss_pct ?? 10);

  const isHalted =
  config.kill_switch_active ||
  is24hHalted ||
  dailyLossBreached ||
  dailyDrawdown >= (config.daily_drawdown_halt || 20) ||
  totalDrawdown >= (config.total_drawdown_kill || 40);

  const saveConfig = useMutation({
    mutationFn: async (updates) => {
      if (configs.length > 0) {
        return base44.entities.BotConfig.update(configs[0].id, updates);
      }
      return base44.entities.BotConfig.create({ ...DEFAULT_CONFIG, ...updates });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['bot-config'] })
  });

  const tradeMutation = useMutation({
    mutationFn: (data) => base44.entities.BotTrade.create(data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['bot-trades'] })
  });

  const drawdownMutation = useMutation({
    mutationFn: (data) => base44.entities.DrawdownLog.create(data)
  });

  const handleConfigUpdate = (updates) => {
    setLocalConfig((prev) => ({ ...prev, ...updates }));
    saveConfig.mutate(updates);
  };

  const handlePriceUpdate = useCallback((update) => {
    setPrices({ btc: update.btc, eth: update.eth });
  }, []);

  useEffect(() => {
    startPriceSimulator(handlePriceUpdate);
    return () => stopPriceSimulator(handlePriceUpdate);
  }, [handlePriceUpdate]);

  // ── Frontend-only opportunity display (for UI preview; server executes trades) ─
  useEffect(() => {
    if (!running || isHalted) {setOpportunities([]);return;}
    const btcP = prices.btc?.price || 97500;
    const ethP = prices.eth?.price || 3200;
    const btcPr = prices.btc?.prev || btcP;
    const ethPr = prices.eth?.prev || ethP;
    const contracts = getPolymarketContracts(btcP, ethP, btcPr, ethPr);
    const lagThresh = config.lag_threshold || 3;
    const edgeThresh = config.edge_threshold || 5;
    const minLiq = config.min_liquidity || 50000;
    const opps = contracts.
    filter((c) => c.lag_pct >= lagThresh && c.lag_pct * 100 >= edgeThresh).
    map((c) => {
      const edgePct = c.lag_pct;
      const confidence = Math.min(99, 50 + edgePct * 3.2);
      const kellySize = Math.min(
        portfolioValue * (config.max_position_pct || 8) / 100,
        Math.max(0, edgePct / 100) * (config.kelly_fraction || 0.5) * portfolioValue
      );
      return {
        ...c, edge_pct: edgePct, confidence_score: confidence,
        kelly_size_usdc: kellySize, recommended_side: c.cex_implied_prob > c.polymarket_price ? 'yes' : 'no',
        // Note: execution by server, flag low depth
        depth_ok: true
      };
    }).
    filter(Boolean).
    sort((a, b) => b.edge_pct - a.edge_pct);
    setOpportunities(opps);
  }, [running, isHalted, prices, config, portfolioValue]);

  // Manual trade execution from the UI scanner
  const handleExecute = async (opp) => {
    if (isHalted) return;
    if (opp.confidence_score < (config.confidence_threshold || 85)) {
      toast.error(`Confidence ${opp.confidence_score.toFixed(0)}% below threshold`);return;
    }
    if (opp.edge_pct < (config.edge_threshold || 5)) {
      toast.error(`Edge ${opp.edge_pct.toFixed(1)}% below threshold`);return;
    }
    const isPaper = config.paper_trading !== false;
    const outcome = Math.random() < opp.cex_implied_prob ? 'win' : 'loss';
    const pnl = outcome === 'win' ?
    opp.kelly_size_usdc * ((1 - opp.polymarket_price) / opp.polymarket_price) :
    -opp.kelly_size_usdc;
    await tradeMutation.mutateAsync({
      market_title: opp.title || opp.market_title,
      asset: opp.asset, contract_type: opp.type || opp.contract_type,
      side: opp.recommended_side, entry_price: opp.polymarket_price,
      exit_price: outcome === 'win' ? 1.0 : 0.0,
      shares: Math.floor(opp.kelly_size_usdc / opp.polymarket_price),
      size_usdc: opp.kelly_size_usdc, edge_at_entry: opp.edge_pct,
      confidence_at_entry: opp.confidence_score, kelly_fraction_used: config.kelly_fraction || 0.5,
      pnl_usdc: Number(pnl.toFixed(4)), outcome, mode: isPaper ? 'paper' : 'live',
      btc_price: prices.btc?.price, eth_price: prices.eth?.price,
      telegram_sent: false, notes: '👆 Manual execute from UI'
    });
    toast.success(`${isPaper ? '📄' : '💰'} ${opp.asset} ${opp.recommended_side?.toUpperCase()} · ${outcome === 'win' ? `+$${pnl.toFixed(2)}` : `-$${Math.abs(pnl).toFixed(2)}`}`, { duration: 5000 });
  };

  // Auto-start bot once config is loaded, if not already running and not halted
  const autoStarted = React.useRef(false);
  useEffect(() => {
    if (!configLoaded || autoStarted.current) return;
    const cfg = configs[0];
    if (!cfg) return;
    const halted = cfg.kill_switch_active || (cfg.halt_until_ts || 0) > Date.now();
    if (!cfg.bot_running && !halted) {
      autoStarted.current = true;
      saveConfig.mutate({ bot_running: true });
      toast.info('▶️ Bot auto-started — runs server-side every 5 min');
    }
  }, [configLoaded, configs]);

  // Toggle writes bot_running to DB — server scheduler reads this flag each run
  const handleToggleRun = () => {
    if (isHalted && !running) return;
    const next = !running;
    handleConfigUpdate({ bot_running: next });
    toast.info(next ? '▶️ Server bot started — runs every 5 min even if you close the window' : '⏸ Server bot paused');
  };

  const handleTogglePaperLive = () => {
    const newMode = !config.paper_trading;
    handleConfigUpdate({ paper_trading: newMode });
    toast.info(newMode ?
    '📄 Switched to PAPER TRADING — no real USDC spent' :
    '💰 Switched to LIVE TRADING — orders execute for real, verify API credentials are set!'
    );
  };

  const isPaper = config.paper_trading !== false || !(config.live_flag_1 && config.live_flag_2 && config.live_flag_3);

  return (
    <div className="flex flex-col min-h-screen">
      <PriceTickerBar btc={prices.btc} eth={prices.eth} connected={prices.btc?.live || false} />

      <div className="flex-1 p-4 md:p-5 max-w-[1600px] mx-auto w-full">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
          <div>
            <div className="flex flex-wrap items-center gap-2 mb-1">
              <h1 className="text-xl font-bold text-foreground font-mono"></h1>
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-bold ${isPaper ? 'bg-chart-4/10 text-chart-4' : 'bg-destructive/20 text-destructive'}`}>
                {isPaper ? '📄 PAPER TRADING' : '💰 LIVE TRADING'}
              </span>
              {isHalted &&
              <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-destructive/20 text-destructive animate-pulse">
                  ⛔ HALTED
                </span>
              }
              {running && !isHalted &&
              <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-accent/10 text-accent animate-pulse">
                  ▶ SERVER RUNNING
                </span>
              }
            </div>
            <p className="text-[11px] text-muted-foreground font-mono">
              BTC/ETH 5-min &amp; 15-min contracts · Half-Kelly sizing · Edge &gt; {config.edge_threshold || 5}% · Conf &gt; {config.confidence_threshold || 85}% · Max pos {config.max_position_pct || 8}%
            </p>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <button
                onClick={handleTogglePaperLive}
                className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors ${
                config.paper_trading ? 'bg-chart-4/20' : 'bg-destructive/20'}`
                }>
                
                <span
                  className={`inline-block h-6 w-6 transform rounded-full bg-foreground transition-transform ${
                  config.paper_trading ? 'translate-x-0.5' : 'translate-x-5'}`
                  } />
                
              </button>
              <span className="text-xs font-mono text-muted-foreground">
                {config.paper_trading ? 'Paper' : 'Live'}
              </span>
            </div>

            <div className="text-sm font-mono">
              <span className="text-muted-foreground text-xs">Portfolio</span>
              <p className="text-foreground font-bold">${portfolioValue.toFixed(2)}</p>
            </div>
            <div className="text-sm font-mono">
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
            <RiskManagementPanel
              config={config}
              onUpdate={handleConfigUpdate}
              dailyDrawdown={dailyDrawdown}
              openPositionCount={openTradeCount} />
            
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
              {!running ?
              <div className="text-center py-8 text-muted-foreground">
                  <p className="text-sm font-mono">Server bot is paused</p>
                  <p className="text-xs mt-1">Start bot — it will keep running server-side even if you close this window</p>
                </div> :
              isHalted ?
              <div className="text-center py-8 text-destructive/70">
                  <p className="text-sm font-mono">⛔ Trading halted — drawdown limit reached</p>
                </div> :

              <OpportunityScanner
                opportunities={opportunities}
                onExecute={handleExecute}
                botRunning={running && !isHalted}
                portfolioValue={portfolioValue}
                maxPosPct={(config.max_position_pct || 8) / 100} />

              }
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
              { label: 'Pending Trades', value: trades.filter((t) => t.outcome === 'pending').length, color: 'text-primary' }].
              map((item) =>
              <div key={item.label} className="flex justify-between items-center py-1.5 border-b border-border/30 last:border-0">
                  <span className="text-xs text-muted-foreground">{item.label}</span>
                  <span className={`text-sm font-mono font-bold ${item.color}`}>{item.value}</span>
                </div>
              )}
            </div>

            <PerformanceMetrics stats={stats} portfolioValue={portfolioValue} startingBalance={startingBalance} paperTrades={trades} />
            <BacktestPanel onApplyThresholds={handleConfigUpdate} />
            <ChecklistPanel />
          </div>
        </div>
      </div>
    </div>);

}

// ── Contract Monitor ───────────────────────────────────────────────────────────
function ContractMonitor({ prices, config }) {
  const btcP = prices.btc?.price || 97500;
  const ethP = prices.eth?.price || 3200;
  const btcPr = prices.btc?.prev || btcP;
  const ethPr = prices.eth?.prev || ethP;
  const contracts = getPolymarketContracts(btcP, ethP, btcPr, ethPr);
  const lagThresh = config?.lag_threshold || 3;

  return (
    <div className="space-y-2">
      {/* Exchange prices header */}
      <div className="grid grid-cols-3 gap-2 text-[10px] font-mono mb-3">
        {[
        { label: 'Binance', btc: prices.btc?.binance, eth: prices.eth?.binance, color: 'text-chart-4' },
        { label: 'Coinbase', btc: prices.btc?.coinbase, eth: prices.eth?.coinbase, color: 'text-primary' },
        { label: 'CoinGecko', btc: prices.btc?.coingecko, eth: prices.eth?.coingecko, color: 'text-accent' }].
        map((ex) =>
        <div key={ex.label} className="rounded-lg bg-secondary/40 border border-border px-2 py-1.5">
            <p className={`font-bold ${ex.color} mb-0.5`}>{ex.label}</p>
            <p className="text-muted-foreground">BTC <span className="text-foreground">{ex.btc ? `$${ex.btc.toLocaleString('en-US', { maximumFractionDigits: 0 })}` : '—'}</span></p>
            <p className="text-muted-foreground">ETH <span className="text-foreground">{ex.eth ? `$${ex.eth.toLocaleString('en-US', { maximumFractionDigits: 0 })}` : '—'}</span></p>
          </div>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-[11px] font-mono">
          <thead>
            <tr className="border-b border-border text-muted-foreground">
              <th className="pb-2 text-left font-medium">Contract</th>
              <th className="pb-2 text-right font-medium">Coinbase</th>
              <th className="pb-2 text-right font-medium">Binance</th>
              <th className="pb-2 text-right font-medium">Spread</th>
              <th className="pb-2 text-right font-medium">Signal</th>
            </tr>
          </thead>
          <tbody>
            {contracts.map((c) => {
              const isArb = c.lag_pct >= lagThresh;
              return (
                <tr key={c.id} className={`border-b border-border/20 last:border-0 transition-colors ${isArb ? 'bg-accent/5' : ''}`}>
                  <td className="py-1.5 text-left">
                    <span className={`px-1 py-0.5 rounded text-[9px] font-bold mr-1 ${c.asset === 'BTC' ? 'bg-chart-4/10 text-chart-4' : 'bg-primary/10 text-primary'}`}>{c.asset}</span>
                    {c.type.replace(/_/g, ' ')}
                  </td>
                  <td className="py-1.5 text-right">{Math.round(c.polymarket_price * 100)}¢</td>
                  <td className="py-1.5 text-right">{Math.round(c.cex_implied_prob * 100)}¢</td>
                  <td className={`py-1.5 text-right font-bold ${isArb ? 'text-accent' : 'text-muted-foreground'}`}>
                    {c.lag_pct.toFixed(1)}pp
                  </td>
                  <td className="py-1.5 text-right">
                    {isArb ?
                    <span className="text-accent font-bold">BUY {c.cex_implied_prob > c.polymarket_price ? 'YES' : 'NO'}</span> :

                    <span className="text-muted-foreground/40">—</span>
                    }
                  </td>
                </tr>);

            })}
          </tbody>
        </table>
      </div>
    </div>);

}