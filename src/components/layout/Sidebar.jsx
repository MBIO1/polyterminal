import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  LayoutDashboard,
  SlidersHorizontal,
  History,
  ArrowLeftRight,
  Activity,
  CalendarDays,
  AlertTriangle,
  BookOpen,
  Plug,
  Zap,
  Radar,
  ClipboardCheck,
  Radio,
  LineChart,
  Scale,
  Percent,
  MonitorPlay,
} from 'lucide-react';

const navItems = [
  { path: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { path: '/config', icon: SlidersHorizontal, label: 'Config' },
  { path: '/scan', icon: Radar, label: 'Market Scan' },
  { path: '/signals', icon: Radio, label: 'Signal Feed' },
  { path: '/funding', icon: Percent, label: 'Funding Capture' },
  { path: '/monitor', icon: Zap, label: 'Live Monitor' },
  { path: '/trade-monitor', icon: MonitorPlay, label: 'Trade Monitor' },
  { path: '/bot-analytics', icon: LineChart, label: 'Bot Analytics' },
  { path: '/trades', icon: History, label: 'Trades' },
  { path: '/transfers', icon: ArrowLeftRight, label: 'Transfers' },
  { path: '/positions', icon: Activity, label: 'Live Positions' },
  { path: '/rebalance', icon: Scale, label: 'Rebalance' },
  { path: '/daily', icon: CalendarDays, label: 'Daily Summary' },
  { path: '/exceptions', icon: AlertTriangle, label: 'Exceptions' },
  { path: '/bybit', icon: Plug, label: 'Bybit' },
  { path: '/sop100', icon: ClipboardCheck, label: '$100 SOP' },
  { path: '/instructions', icon: BookOpen, label: 'Instructions' },
];

export default function Sidebar() {
  const location = useLocation();

  return (
    <aside className="hidden lg:flex flex-col w-64 border-r border-border bg-sidebar h-screen sticky top-0">
      <div className="p-6 border-b border-border">
        <Link to="/" className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-primary/20 flex items-center justify-center">
            <Zap className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="font-sans font-bold text-foreground text-lg tracking-tight">MBIO ARB</h1>
            <p className="text-[10px] font-mono text-muted-foreground tracking-widest uppercase">Cross-Venue</p>
          </div>
        </Link>
      </div>

      <nav className="flex-1 p-4 space-y-1">
        {navItems.map((item) => {
          const isActive = location.pathname === item.path;
          return (
            <Link
              key={item.path}
              to={item.path}
              className={`flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 ${
                isActive
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:text-foreground hover:bg-secondary'
              }`}
            >
              <item.icon className={`w-4 h-4 ${isActive ? 'text-primary' : ''}`} />
              {item.label}
              {isActive && <div className="ml-auto w-1.5 h-1.5 rounded-full bg-primary animate-pulse-glow" />}
            </Link>
          );
        })}
      </nav>

      <div className="p-4 border-t border-border">
        <div className="flex items-center gap-2 px-4 py-2">
          <div className="w-2 h-2 rounded-full bg-accent" />
          <span className="text-xs font-mono text-muted-foreground">v2 Playbook</span>
        </div>
      </div>
    </aside>
  );
}