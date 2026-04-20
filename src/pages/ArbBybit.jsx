import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import Section from '@/components/arb/Section';
import { Button } from '@/components/ui/button';
import { Loader2, CheckCircle2, XCircle, Plug } from 'lucide-react';

export default function ArbBybit() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const runTest = async () => {
    setLoading(true);
    setResult(null);
    setError(null);
    try {
      const res = await base44.functions.invoke('bybitTestConnection', {});
      setResult(res.data);
    } catch (e) {
      setError(e?.response?.data?.error || e.message || 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  const serverTimeOk = result?.serverTime?.retCode === 0;
  const walletOk = result?.walletBalance?.retCode === 0;
  const keyOk = result?.apiKeyInfo?.retCode === 0;
  const allOk = serverTimeOk && walletOk && keyOk;

  return (
    <div className="p-4 md:p-6 lg:p-8 max-w-[1000px] mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
          <Plug className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-foreground">Bybit Connection</h1>
          <p className="text-sm text-muted-foreground mt-0.5 font-mono">Verify API credentials and permissions</p>
        </div>
      </div>

      <Section
        title="Connection Test"
        subtitle="Calls server time, wallet balance, and API key info"
        action={
          <Button onClick={runTest} disabled={loading} size="sm">
            {loading ? <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" /> : <Plug className="w-3.5 h-3.5 mr-2" />}
            Run Test
          </Button>
        }
      >
        {!result && !error && (
          <p className="text-sm text-muted-foreground font-mono">Click Run Test to verify your Bybit credentials.</p>
        )}

        {error && (
          <div className="flex items-start gap-2 p-3 rounded-lg border border-destructive/30 bg-destructive/5">
            <XCircle className="w-4 h-4 text-destructive mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-sm font-medium text-destructive">Request failed</p>
              <p className="text-xs font-mono text-muted-foreground mt-1 break-all">{error}</p>
            </div>
          </div>
        )}

        {result && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground font-mono">Environment:</span>
              <span className={`px-2 py-0.5 rounded border text-[10px] font-mono uppercase ${
                result.environment === 'testnet'
                  ? 'bg-chart-4/10 text-chart-4 border-chart-4/30'
                  : 'bg-destructive/10 text-destructive border-destructive/30'
              }`}>
                {result.environment}
              </span>
              <span className="text-xs font-mono text-muted-foreground">{result.endpoint}</span>
            </div>

            <CheckRow label="Server Time (public)" ok={serverTimeOk} detail={result.serverTime?.retMsg} />
            <CheckRow
              label="Wallet Balance (signed)"
              ok={walletOk}
              detail={walletOk ? 'OK' : `${result.walletBalance?.retCode}: ${result.walletBalance?.retMsg}`}
            />
            <CheckRow
              label="API Key Info (signed)"
              ok={keyOk}
              detail={
                keyOk
                  ? `readOnly=${result.apiKeyInfo?.readOnly} · perms=${JSON.stringify(result.apiKeyInfo?.permissions || {})}`
                  : `${result.apiKeyInfo?.retCode}: ${result.apiKeyInfo?.retMsg}`
              }
            />

            <div className={`flex items-center gap-2 p-3 rounded-lg border ${
              allOk ? 'border-accent/30 bg-accent/5' : 'border-destructive/30 bg-destructive/5'
            }`}>
              {allOk ? (
                <CheckCircle2 className="w-4 h-4 text-accent" />
              ) : (
                <XCircle className="w-4 h-4 text-destructive" />
              )}
              <p className={`text-sm font-medium ${allOk ? 'text-accent' : 'text-destructive'}`}>
                {allOk ? 'All checks passed — ready to build trading functions.' : 'One or more checks failed.'}
              </p>
            </div>

            <details className="text-xs font-mono">
              <summary className="cursor-pointer text-muted-foreground hover:text-foreground">Raw response</summary>
              <pre className="mt-2 p-3 rounded bg-secondary/50 overflow-x-auto text-[11px] leading-relaxed">
                {JSON.stringify(result, null, 2)}
              </pre>
            </details>
          </div>
        )}
      </Section>
    </div>
  );
}

function CheckRow({ label, ok, detail }) {
  return (
    <div className="flex items-start gap-2 p-2.5 rounded border border-border">
      {ok ? (
        <CheckCircle2 className="w-4 h-4 text-accent mt-0.5 flex-shrink-0" />
      ) : (
        <XCircle className="w-4 h-4 text-destructive mt-0.5 flex-shrink-0" />
      )}
      <div className="flex-1 min-w-0">
        <p className="text-sm text-foreground">{label}</p>
        {detail && <p className="text-[11px] font-mono text-muted-foreground mt-0.5 break-all">{detail}</p>}
      </div>
    </div>
  );
}