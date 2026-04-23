/**
 * Distributed Lock Manager for Base44
 * 
 * Prevents race conditions across function invocations using Base44 entities.
 */

const DEFAULT_LOCK_TTL_MS = 30 * 1000; // 30 seconds
const LOCK_RETRY_DELAY_MS = 100;
const MAX_LOCK_RETRIES = 50; // 5 seconds total

/**
 * Acquire a distributed lock
 */
export async function acquireLock(base44, lockName, ttlMs = DEFAULT_LOCK_TTL_MS, owner = null) {
  const lockId = `${lockName}:${Date.now()}:${Math.random().toString(36).slice(2, 11)}`;
  const expiresAt = Date.now() + ttlMs;
  
  for (let attempt = 0; attempt < MAX_LOCK_RETRIES; attempt++) {
    try {
      // Try to create lock
      const lock = await base44.asServiceRole.entities.ArbLock.create({
        lock_name: lockName,
        lock_id: lockId,
        owner: owner || 'system',
        acquired_at: new Date().toISOString(),
        expires_at: new Date(expiresAt).toISOString(),
      });

      return {
        acquired: true,
        lockId,
        release: async () => await releaseLock(base44, lock.id),
        extend: async (extensionMs) => await extendLock(base44, lock.id, extensionMs),
      };
    } catch (error) {
      // Lock exists, check if expired
      const existing = await base44.asServiceRole.entities.ArbLock.filter(
        { lock_name: lockName },
        '-created_date',
        1
      );

      if (existing[0]) {
        const expires = new Date(existing[0].expires_at).getTime();
        
        if (Date.now() > expires) {
          // Lock expired, delete and retry
          await base44.asServiceRole.entities.ArbLock.delete(existing[0].id).catch(() => {});
          continue;
        }
      }

      // Wait before retry
      await new Promise(r => setTimeout(r, LOCK_RETRY_DELAY_MS));
    }
  }

  return { acquired: false, lockId: null };
}

/**
 * Release a lock
 */
export async function releaseLock(base44, lockRecordId) {
  try {
    await base44.asServiceRole.entities.ArbLock.delete(lockRecordId);
    return { released: true };
  } catch (error) {
    console.error('[LockManager] Failed to release lock:', error.message);
    return { released: false, error: error.message };
  }
}

/**
 * Extend a lock's TTL
 */
export async function extendLock(base44, lockRecordId, extensionMs) {
  try {
    const lock = await base44.asServiceRole.entities.ArbLock.get(lockRecordId);
    if (!lock) return { extended: false, error: 'Lock not found' };

    const newExpires = Date.now() + extensionMs;
    await base44.asServiceRole.entities.ArbLock.update(lockRecordId, {
      expires_at: new Date(newExpires).toISOString(),
    });

    return { extended: true, expiresAt: newExpires };
  } catch (error) {
    console.error('[LockManager] Failed to extend lock:', error.message);
    return { extended: false, error: error.message };
  }
}

/**
 * Execute function with lock
 */
export async function withLock(base44, lockName, fn, options = {}) {
  const { 
    ttlMs = DEFAULT_LOCK_TTL_MS, 
    owner = null,
    onLockFail = null 
  } = options;

  const lock = await acquireLock(base44, lockName, ttlMs, owner);

  if (!lock.acquired) {
    if (onLockFail) {
      return await onLockFail();
    }
    throw new Error(`Could not acquire lock: ${lockName}`);
  }

  try {
    const result = await fn(lock);
    return result;
  } finally {
    await lock.release();
  }
}

/**
 * Check if a lock is held
 */
export async function isLocked(base44, lockName) {
  const locks = await base44.asServiceRole.entities.ArbLock.filter(
    { lock_name: lockName },
    '-created_date',
    1
  );

  if (!locks[0]) return false;

  const expires = new Date(locks[0].expires_at).getTime();
  return Date.now() < expires;
}

/**
 * Clean up expired locks
 */
export async function cleanupExpiredLocks(base44) {
  const allLocks = await base44.asServiceRole.entities.ArbLock.list('-created_date', 100);
  const now = Date.now();
  let cleaned = 0;

  for (const lock of allLocks) {
    const expires = new Date(lock.expires_at).getTime();
    if (now > expires) {
      await base44.asServiceRole.entities.ArbLock.delete(lock.id).catch(() => {});
      cleaned++;
    }
  }

  return { cleaned };
}

/**
 * Asset-specific lock names for trade deduplication
 */
export function getAssetLockName(asset, operation = 'trade') {
  return `asset:${asset}:${operation}`;
}

/**
 * Signal-specific lock name
 */
export function getSignalLockName(signalId) {
  return `signal:${signalId}`;
}

export default {
  acquireLock,
  releaseLock,
  extendLock,
  withLock,
  isLocked,
  cleanupExpiredLocks,
  getAssetLockName,
  getSignalLockName,
};
