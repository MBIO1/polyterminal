import React from 'react';
import { BrowserRouter as Router, Route, Routes, Link } from 'react-router-dom';
import { Toaster } from '@/components/ui/toaster';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClientInstance } from '@/lib/query-client';
import './index.css';

// Import pages
import Dashboard from '@/pages/Dashboard';
import Trades from '@/pages/Trades';
import Signals from '@/pages/Signals';
import AlertSettings from '@/pages/AlertSettings';
import ArbConfig from '@/pages/ArbConfig';
import ArbDailySummary from '@/pages/ArbDailySummary';
import SignalAudit from '@/pages/SignalAudit';

// Simple layout component
const Layout = ({ children }) => (
  <div className="min-h-screen bg-background">
    <nav className="border-b bg-card">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-16">
          <div className="flex items-center">
            <Link to="/" className="text-xl font-bold">
              MBIO Arbitrage
            </Link>
          </div>
          <div className="flex items-center space-x-4">
            <Link to="/" className="text-sm font-medium hover:text-primary">Dashboard</Link>
            <Link to="/trades" className="text-sm font-medium hover:text-primary">Trades</Link>
            <Link to="/signals" className="text-sm font-medium hover:text-primary">Signals</Link>
            <Link to="/daily-summary" className="text-sm font-medium hover:text-primary">Daily Summary</Link>
            <Link to="/signal-audit" className="text-sm font-medium hover:text-primary">Signal Audit</Link>
            <Link to="/config" className="text-sm font-medium hover:text-primary">Config</Link>
            <Link to="/alert-settings" className="text-sm font-medium hover:text-primary">Alerts</Link>
          </div>
        </div>
      </div>
    </nav>
    
    <main className="max-w-7xl mx-auto py-6">
      {children}
    </main>
  </div>
);

function App() {
  return (
    <QueryClientProvider client={queryClientInstance}>
    <Router>
      <Layout>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/trades" element={<Trades />} />
          <Route path="/signals" element={<Signals />} />
          <Route path="/alert-settings" element={<AlertSettings />} />
          <Route path="/config" element={<ArbConfig />} />
          <Route path="/daily-summary" element={<ArbDailySummary />} />
          <Route path="/signal-audit" element={<SignalAudit />} />
          <Route path="*" element={<div className="p-6"><h1>404 - Page Not Found</h1></div>} />
        </Routes>
      </Layout>
      <Toaster />
    </Router>
    </QueryClientProvider>
  );
}

export default App;