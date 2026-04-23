/**
 * Comprehensive Audit Logging
 * 
 * Provides detailed audit trails for all trading operations.
 */

const LOG_LEVELS = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
  CRITICAL: 4,
};

const DEFAULT_LOG_LEVEL = 'INFO';

/**
 * Create audit log entry
 */
export async function auditLog(base44, event) {
  const {
    eventType,
    severity = 'INFO',
    message,
    details = {},
    userId = null,
    ipAddress = null,
    requestId = null,
    entityType = null,
    entityId = null,
    metadata = {},
  } = event;

  // Sanitize details to prevent log injection
  const sanitizedDetails = sanitizeForLogging(details);
  const sanitizedMetadata = sanitizeForLogging(metadata);

  const logEntry = {
    event_type: eventType,
    severity,
    message: sanitizeString(message, 1000),
    details: JSON.stringify(sanitizedDetails),
    user_id: userId,
    ip_address: sanitizeString(ipAddress, 45),
    request_id: sanitizeString(requestId, 100),
    entity_type: entityType,
    entity_id: entityId,
    metadata: JSON.stringify(sanitizedMetadata),
    timestamp: new Date().toISOString(),
  };

  try {
    await base44.asServiceRole.entities.ArbAuditLog.create(logEntry);
  } catch (error) {
    // Fallback to console if logging fails
    console.error('[AuditLog] Failed to create log entry:', error.message);
    console.error('[AuditLog] Original event:', JSON.stringify(event));
  }

  // Also log to console for immediate visibility
  const logPrefix = `[AUDIT:${severity}] ${eventType}`;
  if (severity === 'ERROR' || severity === 'CRITICAL') {
    console.error(logPrefix, message, sanitizedDetails);
  } else if (severity === 'WARN') {
    console.warn(logPrefix, message);
  } else {
    console.log(logPrefix, message);
  }

  return { logged: true };
}

/**
 * Log trade execution
 */
export async function logTradeExecution(base44, tradeData, options = {}) {
  const {
    signalId = null,
    executionMode = 'paper',
    userId = null,
    requestId = null,
  } = options;

  return await auditLog(base44, {
    eventType: 'TRADE_EXECUTED',
    severity: executionMode === 'live' ? 'CRITICAL' : 'INFO',
    message: `Trade executed in ${executionMode} mode`,
    details: {
      tradeId: tradeData.trade_id,
      asset: tradeData.asset,
      sizeUsd: tradeData.allocated_capital,
      netPnl: tradeData.net_pnl,
      strategy: tradeData.strategy,
      signalId,
    },
    userId,
    requestId,
    entityType: 'ArbTrade',
    entityId: tradeData.id,
    metadata: {
      executionMode,
      spotExchange: tradeData.spot_exchange,
      perpExchange: tradeData.perp_exchange,
      direction: tradeData.direction,
    },
  });
}

/**
 * Log signal ingestion
 */
export async function logSignalIngested(base44, signalData, options = {}) {
  const {
    source = 'droplet',
    userId = null,
    ipAddress = null,
  } = options;

  return await auditLog(base44, {
    eventType: 'SIGNAL_INGESTED',
    severity: 'INFO',
    message: `Signal ingested from ${source}`,
    details: {
      signalId: signalData.id,
      pair: signalData.pair,
      netEdgeBps: signalData.net_edge_bps,
      rawSpreadBps: signalData.raw_spread_bps,
      fillableSize: signalData.fillable_size_usd,
    },
    userId,
    ipAddress,
    entityType: 'ArbSignal',
    entityId: signalData.id,
    metadata: {
      source,
      buyExchange: signalData.buy_exchange,
      sellExchange: signalData.sell_exchange,
    },
  });
}

/**
 * Log signal rejection
 */
export async function logSignalRejected(base44, signalData, reasons, options = {}) {
  const {
    userId = null,
    requestId = null,
  } = options;

  return await auditLog(base44, {
    eventType: 'SIGNAL_REJECTED',
    severity: 'WARN',
    message: `Signal rejected: ${reasons.join(', ')}`,
    details: {
      signalId: signalData.id,
      pair: signalData.pair,
      reasons,
      netEdgeBps: signalData.net_edge_bps,
    },
    userId,
    requestId,
    entityType: 'ArbSignal',
    entityId: signalData.id,
  });
}

/**
 * Log configuration changes
 */
export async function logConfigChange(base44, oldConfig, newConfig, userId) {
  const changes = [];
  const sensitiveKeys = ['api_key', 'api_secret', 'password', 'token'];

  for (const key of Object.keys(newConfig)) {
    if (oldConfig[key] !== newConfig[key]) {
      const isSensitive = sensitiveKeys.some(sk => key.toLowerCase().includes(sk));
      changes.push({
        key,
        oldValue: isSensitive ? '***' : oldConfig[key],
        newValue: isSensitive ? '***' : newConfig[key],
      });
    }
  }

  if (changes.length === 0) return { logged: false, reason: 'No changes detected' };

  return await auditLog(base44, {
    eventType: 'CONFIG_CHANGED',
    severity: 'INFO',
    message: `Configuration updated by user ${userId}`,
    details: { changes },
    userId,
    entityType: 'ArbConfig',
    metadata: { changeCount: changes.length },
  });
}

/**
 * Log authentication events
 */
export async function logAuthEvent(base44, eventType, userData, options = {}) {
  const {
    success = true,
    ipAddress = null,
    failureReason = null,
  } = options;

  const severities = {
    'LOGIN_SUCCESS': 'INFO',
    'LOGIN_FAILED': 'WARN',
    'LOGOUT': 'INFO',
    'UNAUTHORIZED_ACCESS': 'ERROR',
    'TOKEN_REFRESH': 'INFO',
  };

  return await auditLog(base44, {
    eventType,
    severity: severities[eventType] || 'INFO',
    message: success ? `${eventType} for user ${userData.id}` : `${eventType} failed: ${failureReason}`,
    details: {
      userId: userData.id,
      userRole: userData.role,
      success,
      failureReason,
    },
    userId: userData.id,
    ipAddress,
  });
}

/**
 * Log API errors
 */
export async function logApiError(base44, error, context, options = {}) {
  const {
    endpoint = null,
    requestId = null,
    userId = null,
  } = options;

  return await auditLog(base44, {
    eventType: 'API_ERROR',
    severity: 'ERROR',
    message: `API error in ${context}: ${error.message}`,
    details: {
      errorMessage: error.message,
      errorStack: error.stack,
      endpoint,
      context,
    },
    userId,
    requestId,
    metadata: {
      errorName: error.name,
      isOperational: error.isOperational || false,
    },
  });
}

/**
 * Log security events
 */
export async function logSecurityEvent(base44, eventType, details, options = {}) {
  const {
    severity = 'WARN',
    ipAddress = null,
    userId = null,
  } = options;

  return await auditLog(base44, {
    eventType: `SECURITY_${eventType}`,
    severity,
    message: `Security event: ${eventType}`,
    details,
    userId,
    ipAddress,
  });
}

/**
 * Query audit logs
 */
export async function queryAuditLogs(base44, filters = {}, options = {}) {
  const {
    limit = 100,
    offset = 0,
    sortBy = '-timestamp',
  } = options;

  const where = {};

  if (filters.eventType) where.event_type = filters.eventType;
  if (filters.severity) where.severity = filters.severity;
  if (filters.userId) where.user_id = filters.userId;
  if (filters.entityType) where.entity_type = filters.entityType;
  if (filters.startDate) where.timestamp = { $gte: filters.startDate };
  if (filters.endDate) where.timestamp = { ...where.timestamp, $lte: filters.endDate };

  const logs = await base44.asServiceRole.entities.ArbAuditLog.filter(
    where,
    sortBy,
    limit
  );

  return {
    logs: logs.map(l => ({
      ...l,
      details: safeJsonParse(l.details),
      metadata: safeJsonParse(l.metadata),
    })),
    count: logs.length,
    limit,
    offset,
  };
}

/**
 * Get summary statistics from audit logs
 */
export async function getAuditSummary(base44, timeRangeHours = 24) {
  const since = new Date(Date.now() - (timeRangeHours * 60 * 60 * 1000)).toISOString();

  const logs = await base44.asServiceRole.entities.ArbAuditLog.filter(
    { timestamp: { $gte: since } },
    '-timestamp',
    1000
  );

  const summary = {
    totalEvents: logs.length,
    bySeverity: {},
    byEventType: {},
    tradesExecuted: 0,
    signalsIngested: 0,
    signalsRejected: 0,
    errors: 0,
  };

  for (const log of logs) {
    summary.bySeverity[log.severity] = (summary.bySeverity[log.severity] || 0) + 1;
    summary.byEventType[log.event_type] = (summary.byEventType[log.event_type] || 0) + 1;

    if (log.event_type === 'TRADE_EXECUTED') summary.tradesExecuted++;
    if (log.event_type === 'SIGNAL_INGESTED') summary.signalsIngested++;
    if (log.event_type === 'SIGNAL_REJECTED') summary.signalsRejected++;
    if (log.severity === 'ERROR' || log.severity === 'CRITICAL') summary.errors++;
  }

  return summary;
}

// Helper functions

function sanitizeString(str, maxLength) {
  if (typeof str !== 'string') return '';
  return str.slice(0, maxLength).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
}

function sanitizeForLogging(obj) {
  if (typeof obj !== 'object' || obj === null) return obj;

  const sensitiveKeys = ['password', 'secret', 'api_key', 'api_secret', 'token', 'private_key'];
  const result = {};

  for (const [key, value] of Object.entries(obj)) {
    const isSensitive = sensitiveKeys.some(sk => key.toLowerCase().includes(sk));
    
    if (isSensitive) {
      result[key] = '***REDACTED***';
    } else if (typeof value === 'object' && value !== null) {
      result[key] = sanitizeForLogging(value);
    } else {
      result[key] = value;
    }
  }

  return result;
}

function safeJsonParse(str) {
  try {
    return JSON.parse(str);
  } catch {
    return {};
  }
}

export default {
  auditLog,
  logTradeExecution,
  logSignalIngested,
  logSignalRejected,
  logConfigChange,
  logAuthEvent,
  logApiError,
  logSecurityEvent,
  queryAuditLogs,
  getAuditSummary,
};
