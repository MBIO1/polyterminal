import { Toaster } from "@/components/ui/toaster"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { BrowserRouter as Router, Route, Routes } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import UserNotRegisteredError from '@/components/UserNotRegisteredError';
import AppLayout from '@/components/layout/AppLayout';
import BotDashboard from '@/pages/BotDashboard';
import Markets from '@/pages/Markets';
import Portfolio from '@/pages/Portfolio';
import Trades from '@/pages/Trades';
import Dashboard from '@/pages/Dashboard';
import BotManager from '@/pages/BotManager';
import Analytics from '@/pages/Analytics';
import TradingEngine from '@/pages/TradingEngine';
import PerformanceDashboard from '@/pages/PerformanceDashboard';
import Backtester from '@/pages/Backtester';
import ReportingDashboard from '@/pages/ReportingDashboard';

const AuthenticatedApp = () => {
  const { isLoadingAuth, isLoadingPublicSettings, authError, navigateToLogin } = useAuth();

  if (isLoadingPublicSettings || isLoadingAuth) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-primary/20 border-t-primary rounded-full animate-spin" />
          <span className="text-xs font-mono text-muted-foreground">Loading...</span>
        </div>
      </div>
    );
  }

  if (authError) {
    if (authError.type === 'user_not_registered') return <UserNotRegisteredError />;
    if (authError.type === 'auth_required') { navigateToLogin(); return null; }
  }

  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route path="/" element={<BotDashboard />} />
        <Route path="/overview" element={<Dashboard />} />
        <Route path="/markets" element={<Markets />} />
        <Route path="/portfolio" element={<Portfolio />} />
        <Route path="/trades" element={<Trades />} />
        <Route path="/bot-manager" element={<BotManager />} />
        <Route path="/analytics" element={<Analytics />} />
        <Route path="/trading-engine" element={<TradingEngine />} />
        <Route path="/performance" element={<PerformanceDashboard />} />
        <Route path="/backtest" element={<Backtester />} />
        <Route path="/reports" element={<ReportingDashboard />} />
      </Route>
      <Route path="*" element={<PageNotFound />} />
    </Routes>
  );
};

function App() {
  return (
    <AuthProvider>
      <QueryClientProvider client={queryClientInstance}>
        <Router>
          <AuthenticatedApp />
        </Router>
        <Toaster />
      </QueryClientProvider>
    </AuthProvider>
  );
}

export default App;