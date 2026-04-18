import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  Bot,
  TrendingUp,
  Briefcase,
  History,
  Zap,
  LayoutDashboard,
  SlidersHorizontal,
  BarChart2,
  FlaskConical,
  Cpu,
  LineChart,
  TestTube2,
  FileText } from
'lucide-react';

const navItems = [
{ path: '/', icon: Bot, label: 'Arb Bot' },
{ path: '/overview', icon: LayoutDashboard, label: 'Overview' },
{ path: '/markets', icon: TrendingUp, label: 'Markets' },
{ path: '/portfolio', icon: Briefcase, label: 'Portfolio' },
{ path: '/bot-manager', icon: SlidersHorizontal, label: 'Bot Manager' },
{ path: '/trades', icon: History, label: 'Trade History' },
{ path: '/analytics', icon: BarChart2, label: 'Analytics' },
{ path: '/research', icon: FlaskConical, label: 'Research Report', badge: 'NEW' },
{ path: '/trading-engine', icon: Cpu, label: 'Trading Engine', badge: 'LIVE' },
{ path: '/performance', icon: LineChart, label: 'Performance' },
{ path: '/backtest', icon: TestTube2, label: 'Backtester' },
{ path: '/reports', icon: FileText, label: 'Reports', badge: 'NEW' }];


export default function Sidebar() {
  const location = useLocation();

  return (
    <aside className="hidden lg:flex flex-col w-64 border-r border-border bg-sidebar h-screen sticky top-0">
      {/* Logo */}
      <div className="p-6 border-b border-border">
        <Link to="/" className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-primary/20 flex items-center justify-center">
            <Zap className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="font-sans font-bold text-foreground text-lg tracking-tight"></h1>
            <p className="text-[10px] font-mono text-muted-foreground tracking-widest uppercase">Dashboard</p>
          </div>
        </Link>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-4 space-y-1">
        {navItems.map((item) => {
          const isActive = location.pathname === item.path;
          return (
            <Link
              key={item.path}
              to={item.path}
              className={`flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 ${
              isActive ?
              'bg-primary/10 text-primary' :
              'text-muted-foreground hover:text-foreground hover:bg-secondary'}`
              }>
              
              <item.icon className={`w-4 h-4 ${isActive ? 'text-primary' : ''}`} />
              {item.label}
              {item.badge && !isActive &&
              <span className="ml-auto text-[9px] font-mono px-1 py-0.5 rounded bg-chart-4/20 text-chart-4 font-bold">{item.badge}</span>
              }
              {isActive &&
              <div className="ml-auto w-1.5 h-1.5 rounded-full bg-primary animate-pulse-glow" />
              }
            </Link>);

        })}
      </nav>

      {/* Footer */}
      <div className="p-4 border-t border-border">
        <div className="flex items-center gap-2 px-4 py-2">
          <div className="w-2 h-2 rounded-full bg-accent" />
          <span className="text-xs font-mono text-muted-foreground">Live</span>
        </div>
      </div>
    </aside>);

}