/**
 * Circuit Breaker and Failure Tracking
 * 
 * Monitors consecutive failures and triggers automatic halting.
 */

const DEFAULT_FAILURE_THRESHOLD = 3;
const DEFAULT_FAILURE_WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const DEFAULT_HALT_DURATION_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Record a failure event
 */
export async function recordFailure(base44, failureType, details = {}) {
  const failure = await base44.asServiceRole.entities.ArbFailure.create({
    failure_type: failureType,
    details: JSON.stringify(details),
    timestamp: new Date().toISOString(),
    resolved: false,
  });

  // Check if we need to trigger circuit breaker
  const shouldTrigger = await checkCircuitBreaker(base44, failureType);

  if (shouldTrigger.triggered) {
    await triggerCircuitBreaker(base44, failureType, shouldTrigger.recentCount);
  }

  return { recorded: true, failureId: failure.id, circuitBreaker: shouldTrigger };
}

/**
 * Check if circuit breaker should trigger
 */
export async function checkCircuitBreaker(base44, failureType) {
  const windowStart = new Date(Date.now() - DEFAULT_FAILURE_WINDOW_MS).toISOString();

  const recentFailures = await base44.asServiceRole.entities.ArbFailure.filter(
    { 
      failure_type: failureType,
      timestamp: { $gte: windowStart },
      resolved: false,
    },
    '-timestamp',
    100
  );

  const threshold = getFailureThreshold(failureType);

  return {
    triggered: recentFailures.length >= threshold,
    recentCount: recentFailures.length,
    threshold,
    windowMs: DEFAULT_FAILURE_WINDOW_MS,
  };
}

/**
 * Get failure threshold for different failure types
 */
function getFailureThreshold(failureType) {
  const thresholds = {
    'execution_error': 3,
    'api_error': 5,
    'slippage_exceeded': 3,
    'insufficient_liquidity': 5,
    'authentication_error': 2,
    'rate_limit_hit': 10,
    'partial_fill': 3,
    'network_error': 5,
  };

  return thresholds[failureType] || DEFAULT_FAILURE_THRESHOLD;
}

/**
 * Trigger circuit breaker
 */
export async function triggerCircuitBreaker(base44, reason, failureCount) {
  const haltUntil = Date.now() + DEFAULT_HALT_DURATION_MS;

  // Get current config
  const configs = await base44.asServiceRole.entities.ArbConfig.list('-created_date', 1);
  if (!configs[0]) return { triggered: false, error: 'No config found' };

  await base44.asServiceRole.entities.ArbConfig.update(configs[0].id, {
    bot_running: false,
    kill_switch_active: true,
    halt_until_ts: haltUntil,
    circuit_breaker_triggered_at: new Date().toISOString(),
    circuit_breaker_reason: `${reason} (${failureCount} failures)`,
  });

  // Log the event
  await base44.asServiceRole.entities.ArbAuditLog.create({
    event_type: 'CIRCUIT_BREAKER_TRIGGERED',
    severity: 'CRITICAL',
    message: `Circuit breaker triggered: ${reason}`,
    details: JSON.stringify({
      failureCount,
      haltUntil: new Date(haltUntil).toISOString(),
      haltDurationMinutes: DEFAULT_HALT_DURATION_MS / 60000,
    }),
    timestamp: new Date().toISOString(),
  });

  return {
    triggered: true,
    haltUntil,
    reason,
    failureCount,
  };
}

/**
 * Reset circuit breaker
 */
export async function resetCircuitBreaker(base44, userId) {
  const configs = await base44.asServiceRole.entities.ArbConfig.list('-created_date', 1);
  if (!configs[0]) return { reset: false, error: 'No config found' };

  await base44.asServiceRole.entities.ArbConfig.update(configs[0].id, {
    bot_running: true,
    kill_switch_active: false,
    halt_until_ts: 0,
    circuit_breaker_triggered_at: null,
    circuit_breaker_reason: null,
  });

  // Mark failures as resolved
  const unresolved = await base44.asServiceRole.entities.ArbFailure.filter(
    { resolved: false },
    '-timestamp',
    100
  );

  for (const failure of unresolved) {
    await base44.asServiceRole.entities.ArbFailure.update(failure.id, {
      resolved: true,
      resolved_at: new Date().toISOString(),
      resolved_by: userId,
    });
  }

  // Log the reset
  await base44.asServiceRole.entities.ArbAuditLog.create({
    event_type: 'CIRCUIT_BREAKER_RESET',
    severity: 'INFO',
    message: 'Circuit breaker manually reset',
    details: JSON.stringify({ resolvedBy: userId, failuresCleared: unresolved.length }),
    timestamp: new Date().toISOString(),
  });

  return {
    reset: true,
    failuresCleared: unresolved.length,
  };
}

/**
 * Get circuit breaker status
 */
export async function getCircuitBreakerStatus(base44) {
  const configs = await base44.asServiceRole.entities.ArbConfig.list('-created_date', 1);
  if (!configs[0]) return { error: 'No config found' };

  const config = configs[0];

  const recentFailures = await base44.asServiceRole.entities.ArbFailure.filter(
    { resolved: false },
    '-timestamp',
    50
  );

  const failuresByType = {};
  for (const failure of recentFailures) {
    failuresByType[failure.failure_type] = (failuresByType[failure.failure_type] || 0) + 1;
  }

  const isHalted = config.kill_switch_active ||
    (config.halt_until_ts && config.halt_until_ts > Date.now());

  return {
    isHalted,
    botRunning: config.bot_running,
    killSwitchActive: config.kill_switch_active,
    haltUntil: config.halt_until_ts,
    circuitBreakerReason: config.circuit_breaker_reason,
    circuitBreakerTriggeredAt: config.circuit_breaker_triggered_at,
    recentFailures: recentFailures.length,
    failuresByType,
    canReset: isHalted,
  };
}

/**
 * Execute with automatic failure tracking
 */
export async function withFailureTracking(base44, operationType, fn, options = {}) {
  const { 
    trackSuccess = true,
    metadata = {}
  } = options;

  try {
    const result = await fn();

    if (trackSuccess) {
      // Record success for metrics
      await base44.asServiceRole.entities.ArbAuditLog.create({
        event_type: 'OPERATION_SUCCESS',
        severity: 'INFO',
        message: `${operationType} completed successfully`,
        details: JSON.stringify(metadata),
        timestamp: new Date().toISOString(),
      });
    }

    return { success: true, result };
  } catch (error) {
    // Record failure
    await recordFailure(base44, operationType, {
      error: error.message,
      stack: error.stack,
      ...metadata,
    });

    return { success: false, error: error.message };
  }
}

/**
 * Cleanup old resolved failures
 */
export async function cleanupOldFailures(base44, olderThanDays = 30) {
  const cutoff = new Date(Date.now() - (olderThanDays * 24 * 60 * 60 * 1000)).toISOString();

  const oldFailures = await base44.asServiceRole.entities.ArbFailure.filter(
    { 
      resolved: true,
      resolved_at: { $lt: cutoff },
    },
    '-timestamp',
    1000
  );

  let deleted = 0;
  for (const failure of oldFailures) {
    await base44.asServiceRole.entities.ArbFailure.delete(failure.id).catch(() => {});
    deleted++;
  }

  return { deleted, olderThanDays };
}

export default {
  recordFailure,
  checkCircuitBreaker,
  triggerCircuitBreaker,
  resetCircuitBreaker,
  getCircuitBreakerStatus,
  withFailureTracking,
  cleanupOldFailures,
};
