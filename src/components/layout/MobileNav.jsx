import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Bot, TrendingUp, Briefcase, History, SlidersHorizontal } from 'lucide-react';

const navItems = [
  { path: '/', icon: Bot, label: 'Bot' },
  { path: '/markets', icon: TrendingUp, label: 'Markets' },
  { path: '/portfolio', icon: Briefcase, label: 'Portfolio' },
  { path: '/bot-manager', icon: SlidersHorizontal, label: 'Manager' },
  { path: '/trades', icon: History, label: 'History' },
];

export default function MobileNav() {
  const location = useLocation();

  return (
    <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-50 bg-card/95 backdrop-blur-xl border-t border-border">
      <div className="flex items-center justify-around py-2 px-2">
        {navItems.map((item) => {
          const isActive = location.pathname === item.path;
          return (
            <Link
              key={item.path}
              to={item.path}
              className={`flex flex-col items-center gap-1 px-3 py-1.5 rounded-lg transition-colors ${
                isActive ? 'text-primary' : 'text-muted-foreground'
              }`}
            >
              <item.icon className="w-5 h-5" />
              <span className="text-[10px] font-medium">{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}