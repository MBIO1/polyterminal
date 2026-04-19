/**
 * Live Trading Hub
 * 
 * Displays the Polymarket Arbitrage Bot architecture, config, and code reference.
 * Bot runs locally via node run-bot.js — this page is the control/reference panel.
 */

import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import {
  Bot, Zap, Wallet, BarChart2, Settings, Code2,
  ChevronRight, CheckCircle, AlertTriangle, DollarSign,
  Clock, RefreshCw, Activity, Play, Square, TrendingUp,
} from 'lucide-react';
import { Button } from '@/components/ui/button';

// ── Mini UI helpers ────────────────────────────────────────────────────────────
const Card = ({ children, className = '' }) => (
  <div className={`rounded-xl border border-border bg-card p-5 ${className}`}>{children}</div>
);

const Row = ({ label, value, color = 'text-foreground' }) => (
  <div className="flex justify-between items-center py-1.5 border-b border-border/30 last:border-0">
    <span className="text-xs text-muted-foreground">{label}</span>
    <span className={`text-xs font-mono font-bold ${color}`}>{value}</span>
  </div>
);

const SectionTitle = ({ icon: Icon, title, subtitle, color = 'text-primary' }) => (
  <div className="flex items-start gap-3 mb-4">
    <Icon className={`w-4 h-4 mt-0.5 ${color}`} />
    <div>
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      {subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
    </div>
  </div>
);

// ── Bot config defaults (mirrors run-bot.js) ──────────────────────────────────
const BOT_CONFIG = {
  tradeSize: 50,
  minSpread: 2.5,
  maxSlippage: 0.5,
  gasBuffer: 2,
  pollInterval: 10,
  maxConcurrent: 2,
  maxDailyLosses: 150,
  pairs: ['BTC', 'ETH'],
  timeframes: ['1 min', '5 min'],
};

// ── Module descriptions ────────────────────────────────────────────────────────
const MODULES = [
  {
    file: 'polymarket-arbitrage-bot.js',
    label: 'Core Bot',
    color: 'text-primary',
    bg: 'bg-primary/10',
    desc: 'Main orchestrator — detects arbitrage spreads, executes $50 trades, manages risk & daily stop-loss.',
    methods: ['initialize()', 'start()', 'checkOpportunities()', 'executeTrade(spread)', 'monitorActiveTrades()', 'checkDailyStopLoss()', 'stop()'],
  },
  {
    file: 'polymarket-client.js',
    label: 'Polymarket Client',
    color: 'text-accent',
    bg: 'bg-accent/10',
    desc: 'REST + WebSocket client for Polymarket CLOB — auth, order placement, order book, market data.',
    methods: ['authenticate()', 'getShortTermMarkets()', 'placeOrder(config)', 'cancelOrder(id)', 'getOrderStatus(id)', 'subscribeToMarket(id, cb)'],
  },
  {
    file: 'wallet-manager.js',
    label: 'Wallet Manager',
    color: 'text-chart-4',
    bg: 'bg-chart-4/10',
    desc: 'Ethers.js wrapper for Polygon — USDC balance, approval, transfers, bridge, gas estimation.',
    methods: ['getUSDCBalance()', 'approveUSDC(spender, amt)', 'sendUSDC(to, amt)', 'bridgeToPolygon(amt)', 'estimateTransactionCost()', 'getAccountInfo()'],
  },
  {
    file: 'engine.js',
    label: 'Arbitrage Engine',
    color: 'text-chart-5',
    bg: 'bg-chart-5/10',
    desc: 'Cross-exchange spread detector with adaptive threshold learning based on historical performance.',
    methods: ['fetchPrices()', 'detectArbitrage(prices)', 'recordTrade(symbol, spread, pnl)', 'getStats()', 'stop()'],
  },
];

// ── Run commands ───────────────────────────────────────────────────────────────
const COMMANDS = [
  { cmd: 'node run-bot.js',        desc: 'Start the arbitrage bot' },
  { cmd: 'node check-wallet.js',   desc: 'Verify wallet & USDC balance' },
  { cmd: 'node check-markets.js',  desc: 'Preview spreads & markets' },
  { cmd: 'npm run stats',          desc: 'Export performance report' },
];

// ── Env vars required ──────────────────────────────────────────────────────────
const ENV_VARS = [
  { name: 'POLYMARKET_API_KEY', required: true },
  { name: 'WALLET_PRIVATE_KEY', required: true },
  { name: 'WALLET_ADDRESS',     required: true },
  { name: 'POLYGON_RPC_URL',    required: false, note: 'optional, defaults to polygon-rpc.com' },
];

export default function LiveTradingHub() {
  const [expandedModule, setExpandedModule] = useState(null);

  // Pull live BotTrade stats (live mode) from DB
  const { data: liveTrades = [], refetch, isFetching } = useQuery({
    queryKey: ['live-trades'],
    queryFn: () => base44.entities.BotTrade.filter({ mode: 'live' }, '-created_date', 50),
    refetchInterval: 20000,
  });

  const livePnl    = liveTrades.reduce((s, t) => s + (t.pnl_usdc || 0), 0);
  const liveWins   = liveTrades.filter(t => t.outcome === 'win').length;
  const liveLosses = liveTrades.filter(t => t.outcome === 'loss').length;
  const livePending= liveTrades.filter(t => t.outcome === 'pending').length;
  const winRate    = (liveWins + liveLosses) > 0
    ? ((liveWins / (liveWins + liveLosses)) * 100).toFixed(1)
    : '—';

  return (
    <div className="p-4 md:p-6 max-w-[1400px] mx-auto space-y-6">

      {/* ── Header ── */}
      <div>
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-3">
          <Bot className="w-6 h-6 text-primary" />
          Polymarket Arbitrage Bot
        </h1>
        <p className="text-xs text-muted-foreground mt-1 font-mono">
          Automated BTC/ETH 1-5 min pair trading · $50 trades · Polygon USDC · Local execution
        </p>
      </div>

      {/* ── Info banner ── */}
      <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 flex items-start gap-3">
        <AlertTriangle className="w-4 h-4 text-primary mt-0.5 flex-shrink-0" />
        <div className="text-xs text-muted-foreground space-y-1">
          <p>
            <strong className="text-primary">This bot runs locally on your machine</strong> — Polymarket's CLOB blocks US-datacenter IPs.
            Clone the repo, set your <code className="font-mono bg-secondary/50 px-1 rounded">.env</code>, and run:
          </p>
          <code className="block font-mono bg-secondary/50 text-foreground px-3 py-1.5 rounded-lg mt-1">
            node run-bot.js
          </code>
          <div className="mt-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 flex items-start gap-2">
            <AlertTriangle className="w-3.5 h-3.5 text-destructive mt-0.5 flex-shrink-0" />
            <p className="text-[11px] text-destructive font-semibold">
              <strong>NEVER commit your .env file to GitHub.</strong> Add <code className="font-mono bg-destructive/20 px-1 rounded">.env</code> to <code className="font-mono bg-destructive/20 px-1 rounded">.gitignore</code> before your first commit. If keys were already exposed, rotate them immediately.
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* ── LEFT: Config + Commands ── */}
        <div className="space-y-4">

          <Card>
            <SectionTitle icon={Settings} title="Bot Configuration" subtitle="Mirrors run-bot.js defaults" />
            <Row label="Trade Size" value={`$${BOT_CONFIG.tradeSize}`} color="text-accent" />
            <Row label="Min Spread" value={`${BOT_CONFIG.minSpread}%`} />
            <Row label="Max Slippage" value={`${BOT_CONFIG.maxSlippage}%`} />
            <Row label="Gas Buffer" value={`$${BOT_CONFIG.gasBuffer}`} />
            <Row label="Poll Interval" value={`${BOT_CONFIG.pollInterval}s`} />
            <Row label="Max Concurrent" value={BOT_CONFIG.maxConcurrent} />
            <Row label="Daily Loss Limit" value={`$${BOT_CONFIG.maxDailyLosses}`} color="text-destructive" />
            <Row label="Pairs" value={BOT_CONFIG.pairs.join(', ')} />
            <Row label="Timeframes" value={BOT_CONFIG.timeframes.join(', ')} />
          </Card>

          <Card>
            <SectionTitle icon={Code2} title="Run Commands" subtitle="Execute from project root" />
            <div className="space-y-2">
              {COMMANDS.map(({ cmd, desc }) => (
                <div key={cmd} className="rounded-lg bg-secondary/30 border border-border p-3">
                  <code className="text-xs font-mono text-primary block mb-0.5">{cmd}</code>
                  <p className="text-[10px] text-muted-foreground">{desc}</p>
                </div>
              ))}
            </div>
            <div className="mt-3 rounded-lg border border-destructive/30 bg-destructive/10 p-3">
              <p className="text-[10px] font-mono font-bold text-destructive mb-1.5">⚠️ .gitignore — add this before first commit</p>
              <pre className="text-[10px] font-mono text-foreground bg-secondary/50 rounded p-2 whitespace-pre">{`.env\n.env.local\n*.env\nnode_modules/`}</pre>
              <p className="text-[9px] text-muted-foreground mt-1.5">If <code className="font-mono">.env</code> was already pushed: rotate ALL keys immediately (Polymarket API, wallet private key).</p>
            </div>
          </Card>

          <Card>
            <SectionTitle icon={Zap} title="Environment Variables" subtitle=".env file in project root" />
            <div className="space-y-2">
              {ENV_VARS.map(({ name, required, note }) => (
                <div key={name} className="flex items-start gap-2">
                  <span className={`text-[9px] font-mono px-1 py-0.5 rounded mt-0.5 flex-shrink-0 ${required ? 'bg-destructive/10 text-destructive' : 'bg-muted/50 text-muted-foreground'}`}>
                    {required ? 'REQ' : 'OPT'}
                  </span>
                  <div>
                    <code className="text-[10px] font-mono text-foreground">{name}</code>
                    {note && <p className="text-[9px] text-muted-foreground">{note}</p>}
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>

        {/* ── CENTER: Modules ── */}
        <div className="space-y-4">
          <Card>
            <SectionTitle icon={Code2} title="Architecture Modules" subtitle="Click a module to see its methods" />
            <div className="space-y-3">
              {MODULES.map(mod => (
                <div key={mod.file}>
                  <button
                    onClick={() => setExpandedModule(expandedModule === mod.file ? null : mod.file)}
                    className="w-full rounded-lg border border-border bg-secondary/20 hover:bg-secondary/40 transition-colors p-3 text-left"
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded ${mod.bg} ${mod.color}`}>
                        {mod.label}
                      </span>
                      <ChevronRight className={`w-3 h-3 text-muted-foreground ml-auto transition-transform ${expandedModule === mod.file ? 'rotate-90' : ''}`} />
                    </div>
                    <code className={`text-[10px] font-mono ${mod.color} block mb-1`}>{mod.file}</code>
                    <p className="text-[10px] text-muted-foreground leading-relaxed">{mod.desc}</p>
                  </button>
                  {expandedModule === mod.file && (
                    <div className="mt-1 ml-3 pl-3 border-l-2 border-border space-y-1 py-2">
                      {mod.methods.map(m => (
                        <code key={m} className={`text-[10px] font-mono block ${mod.color}`}>{m}</code>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </Card>

          {/* Flow diagram */}
          <Card>
            <SectionTitle icon={Activity} title="Execution Flow" subtitle="What happens each 10-second cycle" />
            <div className="space-y-2">
              {[
                { step: '1', label: 'Fetch Prices', detail: 'Binance + Coinbase + Polymarket' },
                { step: '2', label: 'Detect Spreads', detail: 'Compare CEX implied prob vs Polymarket price' },
                { step: '3', label: 'Filter Opportunities', detail: 'Spread ≥ 2.5% · pair match · cooldown check' },
                { step: '4', label: 'Execute Trade', detail: 'Place $50 IOC order on both sides' },
                { step: '5', label: 'Monitor Orders', detail: 'Poll fill status · cancel on 60s timeout' },
                { step: '6', label: 'Record P&L', detail: 'Update stats · trigger learning · check daily limit' },
              ].map(({ step, label, detail }) => (
                <div key={step} className="flex items-start gap-3">
                  <div className="w-5 h-5 rounded-full bg-primary/10 text-primary text-[9px] font-bold flex items-center justify-center flex-shrink-0 mt-0.5">
                    {step}
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-foreground">{label}</p>
                    <p className="text-[10px] text-muted-foreground">{detail}</p>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>

        {/* ── RIGHT: Live Stats ── */}
        <div className="space-y-4">

          <Card>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-primary" />
                <h3 className="text-sm font-semibold text-foreground">Live Trade Stats</h3>
              </div>
              <button onClick={() => refetch()} disabled={isFetching} className="text-muted-foreground hover:text-foreground transition-colors">
                <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? 'animate-spin' : ''}`} />
              </button>
            </div>

            {/* P&L Hero */}
            <div className={`rounded-lg border p-4 text-center mb-4 ${livePnl >= 0 ? 'border-accent/20 bg-accent/5' : 'border-destructive/20 bg-destructive/5'}`}>
              <p className="text-[10px] font-mono text-muted-foreground mb-1">REALIZED P&L</p>
              <p className={`text-3xl font-bold font-mono ${livePnl >= 0 ? 'text-accent' : 'text-destructive'}`}>
                {livePnl >= 0 ? '+' : ''}${livePnl.toFixed(2)}
              </p>
              <p className="text-[10px] text-muted-foreground mt-1">{liveTrades.length} live trades total</p>
            </div>

            <Row label="Wins" value={liveWins} color="text-accent" />
            <Row label="Losses" value={liveLosses} color="text-destructive" />
            <Row label="Pending" value={livePending} color="text-primary" />
            <Row
              label="Win Rate"
              value={winRate !== '—' ? `${winRate}%` : '—'}
              color={parseFloat(winRate) >= 50 ? 'text-accent' : winRate === '—' ? 'text-muted-foreground' : 'text-destructive'}
            />
          </Card>

          {/* Recent live trades */}
          <Card>
            <div className="flex items-center gap-2 mb-4">
              <Activity className="w-4 h-4 text-primary" />
              <h3 className="text-sm font-semibold text-foreground">Recent Live Trades</h3>
            </div>
            {liveTrades.length === 0 ? (
              <div className="text-center py-10">
                <Bot className="w-8 h-8 text-muted-foreground/30 mx-auto mb-3" />
                <p className="text-xs text-muted-foreground">No live trades yet</p>
                <p className="text-[10px] text-muted-foreground mt-1">Start the bot locally to see trades here</p>
              </div>
            ) : (
              <div className="space-y-2 max-h-[400px] overflow-y-auto pr-1">
                {liveTrades.slice(0, 20).map(trade => (
                  <div
                    key={trade.id}
                    className={`rounded-lg border p-3 text-xs ${
                      trade.outcome === 'win'  ? 'border-accent/20 bg-accent/5' :
                      trade.outcome === 'loss' ? 'border-destructive/20 bg-destructive/5' :
                      'border-border bg-secondary/20'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-1.5">
                        <span className={`font-mono font-bold text-[10px] px-1.5 py-0.5 rounded ${
                          trade.asset === 'BTC' ? 'bg-chart-4/10 text-chart-4' : 'bg-primary/10 text-primary'
                        }`}>{trade.asset}</span>
                        <span className="font-mono text-muted-foreground text-[10px]">
                          {trade.contract_type?.replace(/_/g, ' ')} · {trade.side?.toUpperCase()}
                        </span>
                      </div>
                      <span className={`font-mono font-bold text-[10px] ${
                        trade.outcome === 'win' ? 'text-accent' :
                        trade.outcome === 'loss' ? 'text-destructive' :
                        'text-primary animate-pulse'
                      }`}>
                        {trade.outcome === 'pending' ? '⏳ PENDING' :
                         trade.outcome === 'win'     ? `+$${(trade.pnl_usdc || 0).toFixed(3)}` :
                                                       `-$${Math.abs(trade.pnl_usdc || 0).toFixed(3)}`}
                      </span>
                    </div>
                    <div className="flex justify-between text-[9px] text-muted-foreground font-mono">
                      <span>Entry: {Math.round((trade.entry_price || 0) * 100)}¢ · ${(trade.size_usdc || 0).toFixed(2)}</span>
                      <span>{new Date(trade.created_date).toLocaleTimeString()}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}