/**
 * Polymarket CLOB API Credential Manager
 *
 * Credentials are stored in localStorage (never sent to our backend).
 * For real trading you need:
 *   1. Polygon wallet private key (signs EIP-712 orders)
 *   2. Polymarket API key (issued via their CLOB auth endpoint)
 *   3. Polymarket API secret + passphrase (used to sign REST requests)
 *
 * The private key is used CLIENT-SIDE ONLY for EIP-712 order signing.
 * It is never transmitted — only the signed order payload is sent to the CLOB.
 */

const STORAGE_KEY = 'polymarket_credentials';

export const CREDENTIAL_FIELDS = [
  {
    key: 'walletAddress',
    label: 'Wallet Address',
    placeholder: '0xYourPolygonWalletAddress',
    sensitive: false,
    description: 'Your Polygon (MATIC) wallet address. Must hold USDC on Polygon.',
  },
  {
    key: 'privateKey',
    label: 'Private Key',
    placeholder: '0x...',
    sensitive: true,
    description: 'Used locally for EIP-712 order signing. NEVER leaves your browser.',
  },
  {
    key: 'apiKey',
    label: 'Polymarket API Key',
    placeholder: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx',
    sensitive: true,
    description: 'Generated via Polymarket CLOB /auth/api-key endpoint.',
  },
  {
    key: 'apiSecret',
    label: 'Polymarket API Secret',
    placeholder: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx',
    sensitive: true,
    description: 'Paired with API Key for REST request signing.',
  },
  {
    key: 'apiPassphrase',
    label: 'Polymarket API Passphrase',
    placeholder: 'your-passphrase',
    sensitive: true,
    description: 'Passphrase chosen when generating the API key.',
  },
];

export function saveCredentials(creds) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(creds));
}

export function loadCredentials() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function clearCredentials() {
  localStorage.removeItem(STORAGE_KEY);
}

export function hasRequiredCredentials(creds) {
  return !!(creds?.walletAddress && creds?.privateKey && creds?.apiKey && creds?.apiSecret && creds?.apiPassphrase);
}

export function maskSecret(value = '') {
  if (!value || value.length < 8) return '••••••••';
  return value.slice(0, 4) + '••••••••' + value.slice(-4);
}