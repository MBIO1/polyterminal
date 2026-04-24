import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { 
  CheckCircle2, 
  XCircle, 
  Loader2, 
  Activity,
  Zap,
  DollarSign,
  Clock
} from 'lucide-react';

export default function OKXLiveTest() {
  const [credentials, setCredentials] = useState({
    apiKey: '',
    apiSecret: '',
    passphrase: '',
    isDemo: true,
  });
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const runTest = async () => {
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const res = await base44.functions.invoke('okxLiveTest', credentials);
      setResult(res.data);
    } catch (e) {
      setError(e?.response?.data?.error || e.message || 'Test failed');
    } finally {
      setLoading(false);
    }
  };

  const getStatusColor = (status) => {
    if (status === 'passed') return 'bg-green-500';
    if (status === 'failed') return 'bg-red-500';
    return 'bg-yellow-500';
  };

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-bold">OKX Live Test</h1>
        <p className="text-muted-foreground mt-1">
          Test OKX API connection, latency, and execution quality
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>API Credentials</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-4">
            <div>
              <Label htmlFor="apiKey">API Key</Label>
              <Input
                id="apiKey"
                type="password"
                value={credentials.apiKey}
                onChange={(e) => setCredentials({ ...credentials, apiKey: e.target.value })}
                placeholder="Enter OKX API Key"
              />
            </div>
            
            <div>
              <Label htmlFor="apiSecret">API Secret</Label>
              <Input
                id="apiSecret"
                type="password"
                value={credentials.apiSecret}
                onChange={(e) => setCredentials({ ...credentials, apiSecret: e.target.value })}
                placeholder="Enter OKX API Secret"
              />
            </div>
            
            <div>
              <Label htmlFor="passphrase">Passphrase</Label>
              <Input
                id="passphrase"
                type="password"
                value={credentials.passphrase}
                onChange={(e) => setCredentials({ ...credentials, passphrase: e.target.value })}
                placeholder="Enter OKX Passphrase"
              />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="isDemo"
              checked={credentials.isDemo}
              onChange={(e) => setCredentials({ ...credentials, isDemo: e.target.checked })}
              className="rounded border-gray-300"
            />
            <Label htmlFor="isDemo" className="text-sm">
              Use Demo/Paper Trading
            </Label>
          </div>

          <Button 
            onClick={runTest} 
            disabled={loading || !credentials.apiKey || !credentials.apiSecret}
            className="w-full"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Testing...
              </>
            ) : (
              <>
                <Zap className="w-4 h-4 mr-2" />
                Run Live Test
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {error && (
        <Alert variant="destructive">
          <XCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {result && (
        <>
          <Card className={result.overall === 'passed' ? 'border-green-500' : 'border-red-500'}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                {result.overall === 'passed' ? (
                  <>
                    <CheckCircle2 className="w-6 h-6 text-green-500" />
                    All Tests Passed
                  </>
                ) : (
                  <>
                    <XCircle className="w-6 h-6 text-red-500" />
                    Tests Failed
                  </>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {result.tests?.balance && (
                  <div className="p-4 bg-secondary rounded-lg">
                    <div className="flex items-center gap-2 mb-2">
                      <DollarSign className="w-4 h-4" />
                      <span className="font-medium">Balance</span>
                    </div>
                    <Badge variant={result.tests.balance.success ? 'default' : 'destructive'}>
                      {result.tests.balance.success ? 'OK' : 'Failed'}
                    </Badge>
                    <div className="text-sm text-muted-foreground mt-1">
                      {result.tests.balance.latency}ms
                    </div>
                  </div>
                )}

                {result.tests?.ticker && (
                  <div className="p-4 bg-secondary rounded-lg">
                    <div className="flex items-center gap-2 mb-2">
                      <Activity className="w-4 h-4" />
                      <span className="font-medium">Ticker</span>
                    </div>
                    <Badge variant={result.tests.ticker.success ? 'default' : 'destructive'}>
                      {result.tests.ticker.success ? 'OK' : 'Failed'}
                    </Badge>
                    <div className="text-sm text-muted-foreground mt-1">
                      {result.tests.ticker.latency}ms
                    </div>
                  </div>
                )}

                {result.tests?.fees && (
                  <div className="p-4 bg-secondary rounded-lg">
                    <div className="flex items-center gap-2 mb-2">
                      <DollarSign className="w-4 h-4" />
                      <span className="font-medium">Fees</span>
                    </div>
                    <Badge variant={result.tests.fees.success ? 'default' : 'destructive'}>
                      {result.tests.fees.success ? 'OK' : 'Failed'}
                    </Badge>
                    <div className="text-xs text-muted-foreground mt-1">
                      Maker: {(result.tests.fees.maker * 100).toFixed(3)}%
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Taker: {(result.tests.fees.taker * 100).toFixed(3)}%
                    </div>
                  </div>
                )}

                {result.tests?.execution && (
                  <div className="p-4 bg-secondary rounded-lg">
                    <div className="flex items-center gap-2 mb-2">
                      <Zap className="w-4 h-4" />
                      <span className="font-medium">Execution</span>
                    </div>
                    <Badge variant={result.tests.execution.success ? 'default' : 'destructive'}>
                      {result.tests.execution.success ? 'OK' : 'Failed'}
                    </Badge>
                    <div className="text-sm text-muted-foreground mt-1">
                      {result.tests.execution.latency}ms
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {result.tests?.ticker?.price && (
            <Card>
              <CardHeader>
                <CardTitle>Market Data</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-mono">
                  BTC: ${parseFloat(result.tests.ticker.price).toLocaleString()}
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
