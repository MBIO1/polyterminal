import { Toaster } from "@/components/ui/toaster"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { BrowserRouter as Router, Route, Routes } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import UserNotRegisteredError from '@/components/UserNotRegisteredError';
import AppLayout from '@/components/layout/AppLayout';
import ArbDashboard from '@/pages/ArbDashboard';
import ArbConfig from '@/pages/ArbConfig';
import ArbTrades from '@/pages/ArbTrades';
import ArbTransfers from '@/pages/ArbTransfers';
import ArbLivePositions from '@/pages/ArbLivePositions';
import ArbDailySummary from '@/pages/ArbDailySummary';
import ArbExceptions from '@/pages/ArbExceptions';
import ArbInstructions from '@/pages/ArbInstructions';

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
        <Route path="/" element={<ArbDashboard />} />
        <Route path="/config" element={<ArbConfig />} />
        <Route path="/trades" element={<ArbTrades />} />
        <Route path="/transfers" element={<ArbTransfers />} />
        <Route path="/positions" element={<ArbLivePositions />} />
        <Route path="/daily" element={<ArbDailySummary />} />
        <Route path="/exceptions" element={<ArbExceptions />} />
        <Route path="/instructions" element={<ArbInstructions />} />
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