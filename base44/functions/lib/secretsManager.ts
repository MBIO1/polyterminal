/**
 * Secure Secrets Manager for Base44 Environment
 * 
 * Provides encrypted storage and access control for API keys and sensitive data.
 * Uses Base44 entities for persistence with encryption at rest.
 */

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const ENCRYPTION_KEY_ENV = 'ARB_ENCRYPTION_KEY';
const MAX_KEY_AGE_DAYS = 90;

/**
 * Simple XOR encryption for demonstration - REPLACE with AES-256-GCM in production
 * In production, use Web Crypto API with proper key management
 */
async function encrypt(text, key) {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const keyData = encoder.encode(key.padEnd(32, '0').slice(0, 32));
  
  const encrypted = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) {
    encrypted[i] = data[i] ^ keyData[i % keyData.length];
  }
  
  return btoa(String.fromCharCode(...encrypted));
}

async function decrypt(encryptedBase64, key) {
  const decoder = new TextDecoder();
  const keyData = new TextEncoder().encode(key.padEnd(32, '0').slice(0, 32));
  
  const encrypted = Uint8Array.from(atob(encryptedBase64), c => c.charCodeAt(0));
  const decrypted = new Uint8Array(encrypted.length);
  
  for (let i = 0; i < encrypted.length; i++) {
    decrypted[i] = encrypted[i] ^ keyData[i % keyData.length];
  }
  
  return decoder.decode(decrypted);
}

/**
 * Get encryption key from environment or throw
 */
function getEncryptionKey() {
  const key = Deno.env.get(ENCRYPTION_KEY_ENV);
  if (!key) {
    console.warn('[SecretsManager] No encryption key set - using environment variables directly');
    return null;
  }
  return key;
}

/**
 * Secure secrets manager class
 */
export class SecureSecretsManager {
  constructor(base44Client) {
    this.base44 = base44Client;
    this.cache = new Map();
    this.cacheExpiry = new Map();
    this.CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
  }

  /**
   * Store a secret securely
   */
  async storeSecret(keyName, value, metadata = {}) {
    const encryptionKey = getEncryptionKey();
    
    if (!encryptionKey) {
      // Fallback: store warning but don't encrypt
      console.warn(`[SecretsManager] Storing ${keyName} without encryption`);
    }

    const encrypted = encryptionKey 
      ? await encrypt(value, encryptionKey)
      : value;

    const existing = await this.base44.asServiceRole.entities.ArbSecret.filter(
      { key_name: keyName },
      '-created_date',
      1
    );

    const record = {
      key_name: keyName,
      encrypted_value: encrypted,
      is_encrypted: !!encryptionKey,
      last_rotated: new Date().toISOString(),
      metadata: JSON.stringify({
        ...metadata,
        stored_at: new Date().toISOString(),
      }),
    };

    if (existing[0]) {
      await this.base44.asServiceRole.entities.ArbSecret.update(existing[0].id, record);
    } else {
      await this.base44.asServiceRole.entities.ArbSecret.create(record);
    }

    // Clear cache
    this.cache.delete(keyName);
    this.cacheExpiry.delete(keyName);

    return { success: true, keyName };
  }

  /**
   * Retrieve and decrypt a secret
   */
  async getSecret(keyName) {
    // Check cache
    const cached = this.cache.get(keyName);
    const expiry = this.cacheExpiry.get(keyName);
    if (cached && expiry && Date.now() < expiry) {
      return cached;
    }

    const records = await this.base44.asServiceRole.entities.ArbSecret.filter(
      { key_name: keyName },
      '-created_date',
      1
    );

    if (!records[0]) {
      return null;
    }

    const record = records[0];
    const encryptionKey = getEncryptionKey();

    let value;
    if (record.is_encrypted && encryptionKey) {
      value = await decrypt(record.encrypted_value, encryptionKey);
    } else {
      value = record.encrypted_value;
    }

    // Check key age
    const lastRotated = new Date(record.last_rotated);
    const ageDays = (Date.now() - lastRotated.getTime()) / (1000 * 60 * 60 * 24);
    
    if (ageDays > MAX_KEY_AGE_DAYS) {
      console.warn(`[SecretsManager] Secret ${keyName} is ${ageDays.toFixed(0)} days old - rotation recommended`);
    }

    // Cache result
    this.cache.set(keyName, value);
    this.cacheExpiry.set(keyName, Date.now() + this.CACHE_TTL_MS);

    return value;
  }

  /**
   * Check if a secret exists
   */
  async hasSecret(keyName) {
    const records = await this.base44.asServiceRole.entities.ArbSecret.filter(
      { key_name: keyName },
      '-created_date',
      1
    );
    return records.length > 0;
  }

  /**
   * Delete a secret
   */
  async deleteSecret(keyName) {
    const records = await this.base44.asServiceRole.entities.ArbSecret.filter(
      { key_name: keyName },
      '-created_date',
      1
    );

    if (records[0]) {
      await this.base44.asServiceRole.entities.ArbSecret.delete(records[0].id);
    }

    this.cache.delete(keyName);
    this.cacheExpiry.delete(keyName);

    return { success: true };
  }

  /**
   * Get all secrets needing rotation
   */
  async getSecretsNeedingRotation(maxAgeDays = MAX_KEY_AGE_DAYS) {
    const allSecrets = await this.base44.asServiceRole.entities.ArbSecret.list('-created_date', 100);
    const cutoff = Date.now() - (maxAgeDays * 24 * 60 * 60 * 1000);
    
    return allSecrets.filter(s => {
      const rotated = new Date(s.last_rotated).getTime();
      return rotated < cutoff;
    });
  }
}

/**
 * Get API credentials with fallback to environment variables
 */
export async function getApiCredentials(base44, exchange) {
  const manager = new SecureSecretsManager(base44);
  
  const apiKey = await manager.getSecret(`${exchange}_API_KEY`) || Deno.env.get(`${exchange}_API_KEY`);
  const apiSecret = await manager.getSecret(`${exchange}_API_SECRET`) || Deno.env.get(`${exchange}_API_SECRET`);
  
  if (!apiKey || !apiSecret) {
    throw new Error(`${exchange} API credentials not configured`);
  }

  return { apiKey, apiSecret };
}

/**
 * Validate API key format and permissions
 */
export function validateApiKeyFormat(exchange, apiKey) {
  const patterns = {
    bybit: /^[A-Za-z0-9]{18,}$/,
    okx: /^[a-f0-9]{32}$/,
  };

  const pattern = patterns[exchange.toLowerCase()];
  if (!pattern) return { valid: true }; // Unknown exchange, skip validation

  if (!pattern.test(apiKey)) {
    return { valid: false, error: `Invalid ${exchange} API key format` };
  }

  return { valid: true };
}

export default SecureSecretsManager;
