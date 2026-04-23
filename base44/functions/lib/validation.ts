/**
 * Input Validation and Sanitization Utilities
 */

const VALIDATION_RULES = {
  tradeId: {
    pattern: /^[A-Za-z0-9_-]{1,50}$/,
    message: 'Trade ID must be 1-50 alphanumeric characters, underscores, or hyphens',
  },
  asset: {
    allowed: ['BTC', 'ETH', 'SOL', 'Other'],
    message: 'Asset must be one of: BTC, ETH, SOL, Other',
  },
  exchange: {
    allowed: ['Binance', 'Coinbase International', 'Kraken', 'OKX', 'Bybit', 'Deribit', 'Bitget', 'Hyperliquid', 'dYdX', 'Other'],
    message: 'Invalid exchange name',
  },
  price: {
    min: 0.00000001,
    max: 1000000000,
    message: 'Price must be between 0.00000001 and 1,000,000,000',
  },
  quantity: {
    min: 0.00000001,
    max: 1000000000,
    message: 'Quantity must be between 0.00000001 and 1,000,000,000',
  },
  bps: {
    min: -10000,
    max: 10000,
    message: 'Basis points must be between -10,000 and 10,000',
  },
  usdAmount: {
    min: 0,
    max: 100000000,
    message: 'USD amount must be between 0 and 100,000,000',
  },
  percentage: {
    min: 0,
    max: 1,
    message: 'Percentage must be between 0 and 1',
  },
};

/**
 * Sanitize string input
 */
export function sanitizeString(input, maxLength = 1000) {
  if (typeof input !== 'string') return '';
  
  return input
    .trim()
    .slice(0, maxLength)
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '') // Remove control characters
    .replace(/[\u200B-\u200D\uFEFF]/g, ''); // Remove zero-width characters
}

/**
 * Sanitize numeric input
 */
export function sanitizeNumber(input, options = {}) {
  const { 
    min = -Infinity, 
    max = Infinity, 
    decimals = 8,
    allowNull = true 
  } = options;

  if (input === null || input === undefined) {
    return allowNull ? null : 0;
  }

  let num;
  if (typeof input === 'string') {
    // Remove commas and whitespace
    const cleaned = input.replace(/,/g, '').trim();
    num = Number(cleaned);
  } else {
    num = Number(input);
  }

  if (isNaN(num)) {
    return allowNull ? null : 0;
  }

  if (!isFinite(num)) {
    return allowNull ? null : 0;
  }

  // Clamp to range
  num = Math.max(min, Math.min(max, num));

  // Round to specified decimals
  const factor = Math.pow(10, decimals);
  num = Math.round(num * factor) / factor;

  return num;
}

/**
 * Validate and sanitize trade data
 */
export function validateTradeData(data) {
  const errors = [];
  const sanitized = {};

  // Trade ID
  if (data.trade_id !== undefined) {
    const clean = sanitizeString(data.trade_id, 50);
    if (!VALIDATION_RULES.tradeId.pattern.test(clean)) {
      errors.push(VALIDATION_RULES.tradeId.message);
    } else {
      sanitized.trade_id = clean;
    }
  }

  // Asset
  if (data.asset !== undefined) {
    const clean = sanitizeString(data.asset, 20);
    if (!VALIDATION_RULES.asset.allowed.includes(clean)) {
      errors.push(VALIDATION_RULES.asset.message);
    } else {
      sanitized.asset = clean;
    }
  }

  // Exchanges
  if (data.spot_exchange !== undefined) {
    const clean = sanitizeString(data.spot_exchange, 50);
    if (!VALIDATION_RULES.exchange.allowed.includes(clean)) {
      errors.push(`Spot ${VALIDATION_RULES.exchange.message}`);
    } else {
      sanitized.spot_exchange = clean;
    }
  }

  if (data.perp_exchange !== undefined) {
    const clean = sanitizeString(data.perp_exchange, 50);
    if (!VALIDATION_RULES.exchange.allowed.includes(clean)) {
      errors.push(`Perp ${VALIDATION_RULES.exchange.message}`);
    } else {
      sanitized.perp_exchange = clean;
    }
  }

  // Prices
  const priceFields = ['spot_entry_px', 'spot_exit_px', 'perp_entry_px', 'perp_exit_px', 'buy_price', 'sell_price'];
  for (const field of priceFields) {
    if (data[field] !== undefined) {
      const clean = sanitizeNumber(data[field], VALIDATION_RULES.price);
      if (clean === null || clean === 0) {
        errors.push(`${field}: ${VALIDATION_RULES.price.message}`);
      } else {
        sanitized[field] = clean;
      }
    }
  }

  // Quantities
  const qtyFields = ['spot_qty', 'perp_qty', 'qty'];
  for (const field of qtyFields) {
    if (data[field] !== undefined) {
      const clean = sanitizeNumber(data[field], VALIDATION_RULES.quantity);
      if (clean === null) {
        errors.push(`${field}: ${VALIDATION_RULES.quantity.message}`);
      } else {
        sanitized[field] = clean;
      }
    }
  }

  // USD amounts
  const usdFields = ['size_usd', 'fillable_size_usd', 'allocated_capital', 'margin_used', 'net_pnl'];
  for (const field of usdFields) {
    if (data[field] !== undefined) {
      const clean = sanitizeNumber(data[field], { ...VALIDATION_RULES.usdAmount, allowNull: true });
      sanitized[field] = clean;
    }
  }

  // Basis points
  const bpsFields = ['raw_spread_bps', 'net_edge_bps', 'entry_spread_bps', 'exit_spread_bps'];
  for (const field of bpsFields) {
    if (data[field] !== undefined) {
      const clean = sanitizeNumber(data[field], VALIDATION_RULES.bps);
      if (clean === null) {
        errors.push(`${field}: ${VALIDATION_RULES.bps.message}`);
      } else {
        sanitized[field] = clean;
      }
    }
  }

  // Percentages
  const pctFields = ['reserve_pct', 'spot_allocation_pct', 'perp_collateral_pct'];
  for (const field of pctFields) {
    if (data[field] !== undefined) {
      const clean = sanitizeNumber(data[field], VALIDATION_RULES.percentage);
      if (clean === null) {
        errors.push(`${field}: ${VALIDATION_RULES.percentage.message}`);
      } else {
        sanitized[field] = clean;
      }
    }
  }

  // Text fields
  const textFields = ['entry_thesis', 'exit_reason', 'review_notes', 'notes'];
  for (const field of textFields) {
    if (data[field] !== undefined) {
      sanitized[field] = sanitizeString(data[field], 5000);
    }
  }

  // Status
  if (data.status !== undefined) {
    const validStatuses = ['Planned', 'Open', 'Closed', 'Cancelled', 'Error', 'detected', 'alerted', 'executed', 'rejected', 'expired'];
    const clean = sanitizeString(data.status, 20);
    if (validStatuses.includes(clean)) {
      sanitized.status = clean;
    } else {
      errors.push(`Invalid status: ${clean}`);
    }
  }

  // Mode
  if (data.mode !== undefined) {
    const clean = sanitizeString(data.mode, 10);
    if (['paper', 'live'].includes(clean)) {
      sanitized.mode = clean;
    } else {
      errors.push(`Mode must be 'paper' or 'live'`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    sanitized,
  };
}

/**
 * Validate signal data
 */
export function validateSignalData(data) {
  const errors = [];
  const sanitized = {};

  // Required fields
  const required = ['pair', 'buy_exchange', 'sell_exchange', 'raw_spread_bps', 'net_edge_bps'];
  for (const field of required) {
    if (data[field] === undefined || data[field] === null) {
      errors.push(`Missing required field: ${field}`);
    }
  }

  // Pair format (e.g., "BTC-USDT")
  if (data.pair !== undefined) {
    const clean = sanitizeString(data.pair, 20);
    if (!/^[A-Z]{2,10}-[A-Z]{2,10}$/.test(clean)) {
      errors.push('Pair must be in format ASSET-QUOTE (e.g., BTC-USDT)');
    } else {
      sanitized.pair = clean;
    }
  }

  // Exchanges
  const exchanges = ['buy_exchange', 'sell_exchange'];
  for (const field of exchanges) {
    if (data[field] !== undefined) {
      const clean = sanitizeString(data[field], 50);
      sanitized[field] = clean;
    }
  }

  // Prices
  if (data.buy_price !== undefined) {
    sanitized.buy_price = sanitizeNumber(data.buy_price, VALIDATION_RULES.price);
  }
  if (data.sell_price !== undefined) {
    sanitized.sell_price = sanitizeNumber(data.sell_price, VALIDATION_RULES.price);
  }

  // Spreads
  if (data.raw_spread_bps !== undefined) {
    sanitized.raw_spread_bps = sanitizeNumber(data.raw_spread_bps, VALIDATION_RULES.bps);
  }
  if (data.net_edge_bps !== undefined) {
    sanitized.net_edge_bps = sanitizeNumber(data.net_edge_bps, VALIDATION_RULES.bps);
  }

  // Depth and fillable
  if (data.buy_depth_usd !== undefined) {
    sanitized.buy_depth_usd = sanitizeNumber(data.buy_depth_usd, { min: 0, max: 1000000000, decimals: 2 });
  }
  if (data.sell_depth_usd !== undefined) {
    sanitized.sell_depth_usd = sanitizeNumber(data.sell_depth_usd, { min: 0, max: 1000000000, decimals: 2 });
  }
  if (data.fillable_size_usd !== undefined) {
    sanitized.fillable_size_usd = sanitizeNumber(data.fillable_size_usd, { min: 0, max: 1000000000, decimals: 2 });
  }

  // Timing
  if (data.signal_age_ms !== undefined) {
    const clean = sanitizeNumber(data.signal_age_ms, { min: 0, max: 300000, decimals: 0 });
    sanitized.signal_age_ms = clean;
  }
  if (data.exchange_latency_ms !== undefined) {
    const clean = sanitizeNumber(data.exchange_latency_ms, { min: 0, max: 60000, decimals: 0 });
    sanitized.exchange_latency_ms = clean;
  }

  // Confirmed exchanges
  if (data.confirmed_exchanges !== undefined) {
    const clean = sanitizeNumber(data.confirmed_exchanges, { min: 1, max: 10, decimals: 0 });
    sanitized.confirmed_exchanges = clean;
  }

  // Alert flag
  if (data.alert !== undefined) {
    sanitized.alert = Boolean(data.alert);
  }

  return {
    valid: errors.length === 0,
    errors,
    sanitized,
  };
}

/**
 * Check for suspicious patterns in input
 */
export function detectSuspiciousInput(data) {
  const issues = [];

  const stringified = JSON.stringify(data);

  // Check for injection attempts
  const suspiciousPatterns = [
    { pattern: /[\$\{].*?\}/, desc: 'Possible template injection' },
    { pattern: /__proto__|constructor|prototype/, desc: 'Prototype pollution attempt' },
    { pattern: /[\x00-\x08\x0B\x0C\x0E-\x1F]/, desc: 'Control characters detected' },
    { pattern: /<script|javascript:|on\w+=/i, desc: 'Possible XSS attempt' },
    { pattern: /SELECT\s+.*\s+FROM|INSERT\s+INTO|DELETE\s+FROM/i, desc: 'Possible SQL injection' },
  ];

  for (const { pattern, desc } of suspiciousPatterns) {
    if (pattern.test(stringified)) {
      issues.push(desc);
    }
  }

  // Check for oversized payloads
  if (stringified.length > 100000) {
    issues.push('Oversized payload (> 100KB)');
  }

  // Check for nested objects (possible prototype pollution)
  const depth = JSON.stringify(data).split(/\{|\}/).length;
  if (depth > 50) {
    issues.push('Excessively nested object structure');
  }

  return {
    suspicious: issues.length > 0,
    issues,
  };
}

export default {
  sanitizeString,
  sanitizeNumber,
  validateTradeData,
  validateSignalData,
  detectSuspiciousInput,
};
