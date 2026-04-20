export const ASSETS = ['BTC', 'ETH', 'SOL', 'Other'];
export const EXCHANGES = [
  'Binance', 'Coinbase International', 'Kraken', 'OKX', 'Bybit',
  'Deribit', 'Bitget', 'Hyperliquid', 'dYdX', 'Other',
];
export const STRATEGIES = [
  'Same-venue Spot/Perp Carry',
  'Cross-venue Perp/Perp',
  'Cross-venue Spot Spread',
  'Funding Capture',
];
export const TRADE_STATUS = ['Planned', 'Open', 'Closed', 'Cancelled', 'Error'];
export const TRANSFER_TYPES = [
  'Deposit', 'Withdrawal', 'Internal Transfer',
  'Rebalance Buy', 'Rebalance Sell', 'Funding Payment', 'Fee Adjustment',
];
export const TRANSFER_ASSETS = ['BTC', 'ETH', 'SOL', 'USDC', 'USDT', 'Other'];
export const TRANSFER_STATUS = ['Planned', 'Pending', 'Completed', 'Failed'];
export const ORDER_TYPES = ['Post-only Limit', 'Limit', 'Market', 'TWAP', ''];
export const FEE_TYPES = ['Maker', 'Taker', 'Mixed', ''];
export const POSITION_STATUS = ['Open', 'Closing', 'Closed', 'Error'];
export const EXCEPTION_TYPES = ['Execution', 'Reconciliation', 'Latency', 'Margin', 'Transfer', 'Other'];
export const EXCEPTION_STATUS = ['Open', 'Closed', 'Monitoring'];
export const SEVERITIES = ['Low', 'Medium', 'High', 'Critical'];

export const fmtUSD = (n, d = 2) =>
  (n == null || isNaN(n)) ? '—' : `$${Number(n).toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d })}`;

export const fmtNum = (n, d = 4) =>
  (n == null || isNaN(n)) ? '—' : Number(n).toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });

export const fmtPct = (n, d = 2) =>
  (n == null || isNaN(n)) ? '—' : `${(Number(n) * 100).toFixed(d)}%`;

export const fmtBps = (n, d = 1) =>
  (n == null || isNaN(n)) ? '—' : `${Number(n).toFixed(d)} bps`;

// Net PnL = basis + realized funding - all fees - borrow
export const computeNetPnl = (t) => {
  const basis = Number(t.basis_pnl || 0);
  const funding = Number(t.realized_funding || 0);
  const fees =
    Number(t.spot_entry_fee || 0) + Number(t.perp_entry_fee || 0) +
    Number(t.spot_exit_fee || 0)  + Number(t.perp_exit_fee || 0)  +
    Number(t.borrow_conversion_cost || 0);
  return basis + funding - fees;
};

export const computeSpreadBps = (spotPx, perpPx) => {
  const s = Number(spotPx), p = Number(perpPx);
  if (!s || !p) return null;
  return ((p - s) / s) * 10000;
};

export const sumBy = (arr, key) =>
  (arr || []).reduce((a, x) => a + Number(x?.[key] || 0), 0);