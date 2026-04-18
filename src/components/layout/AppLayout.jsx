import React from 'react';
import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import MobileNav from './MobileNav';
import LiveTicker from '@/components/LiveTicker';

export default function AppLayout() {
  return (
    <div className="flex min-h-screen bg-background font-sans">
      <Sidebar />
      <main className="flex-1 min-h-screen pb-20 lg:pb-0">
        <div className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur-sm px-4 md:px-6 py-3">
          <div className="flex justify-end">
            <LiveTicker />
          </div>
        </div>
        <Outlet />
      </main>
      <MobileNav />
    </div>
  );
}