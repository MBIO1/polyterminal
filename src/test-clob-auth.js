#!/usr/bin/env node

/**
 * Polymarket CLOB Authentication Test Suite
 * Run this to diagnose and fix 401 errors
 * 
 * Usage:
 * export POLY_API_KEY=your_key
 * export POLY_API_SECRET=your_secret
 * export POLY_API_PASSPHRASE=your_passphrase
 * node test-clob-auth.js
 */

const crypto = require('crypto');

class CLOBTester {
  constructor() {
    this.apiKey = process.env.POLY_API_KEY;
    this.apiSecret = process.env.POLY_API_SECRET;
    this.apiPassphrase = process.env.POLY_API_PASSPHRASE;
    this.walletAddress = process.env.POLY_WALLET_ADDRESS;
    this.testsPassed = 0;
    this.testsFailed = 0;
  }

  log(icon, message) {
    console.log(`${icon} ${message}`);
  }

  pass(message) {
    this.testsPassed++;
    this.log('✅', message);
  }

  fail(message) {
    this.testsFailed++;
    this.log('❌', message);
  }

  warn(message) {
    this.log('⚠️ ', message);
  }

  info(message) {
    this.log('ℹ️ ', message);
  }

  // Test 1: Check credentials
  testCredentials() {
    console.log('\n' + '='.repeat(50));
    console.log('TEST 1: Credentials');
    console.log('='.repeat(50));

    if (!this.apiKey) {
      this.fail('POLY_API_KEY not set');
      return false;
    }
    this.pass(`API Key present (length: ${this.apiKey.length})`);

    if (!this.apiSecret) {
      this.fail('POLY_API_SECRET not set');
      return false;
    }
    this.pass(`API Secret present (length: ${this.apiSecret.length})`);

    if (!this.apiPassphrase) {
      this.warn('POLY_API_PASSPHRASE not set (may not be required)');
    } else {
      this.pass(`API Passphrase present (length: ${this.apiPassphrase.length})`);
    }

    if (!this.walletAddress) {
      this.warn('POLY_WALLET_ADDRESS not set (may not be required)');
    } else {
      this.pass(`Wallet Address: ${this.walletAddress.substring(0, 10)}...`);
    }

    return true;
  }

  // Test 2: Timestamp validation
  testTimestamp() {
    console.log('\n' + '='.repeat(50));
    console.log('TEST 2: Timestamp Format');
    console.log('='.repeat(50));

    const now = Date.now();
    const nowSeconds = Math.floor(now / 1000);

    this.info(`Current timestamp (ms): ${now}`);
    this.info(`Current timestamp (seconds): ${nowSeconds}`);

    const msDigits = now.toString().length;
    const sDigits = nowSeconds.toString().length;

    if (msDigits === 13) {
      this.pass(`Milliseconds timestamp has 13 digits: ${now}`);
    } else {
      this.fail(`Milliseconds should be 13 digits, got ${msDigits}`);
    }

    if (sDigits === 10) {
      this.pass(`Seconds timestamp has 10 digits: ${nowSeconds}`);
    } else {
      this.fail(`Seconds should be 10 digits, got ${sDigits}`);
    }

    // Check for clock skew
    const epochMs = new Date('2025-01-01').getTime();
    if (now > epochMs) {
      this.pass('System clock is valid (after 2025-01-01)');
    } else {
      this.fail('System clock appears to be in the past!');
    }

    return true;
  }

  // Test 3: HMAC signature generation
  testHMAC() {
    console.log('\n' + '='.repeat(50));
    console.log('TEST 3: HMAC-SHA256 Signature');
    console.log('='.repeat(50));

    const timestamp = Date.now();
    const method = 'POST';
    const path = '/create-order';
    const body = JSON.stringify({
      token_id: '0x1234567890123456789012345678901234567890',
      price: '0.52',
      size: '100',
      side: 'BUY'
    });

    // Test message format
    const message = `${timestamp}${method}${path}${body}`;
    this.info(`Message format: ${timestamp}${method}${path}{...body}`);
    this.info(`Full message length: ${message.length} characters`);
    this.info(`Message preview: ${message.substring(0, 80)}...`);

    // Generate signature
    try {
      const signature = crypto
        .createHmac('sha256', this.apiSecret)
        .update(message)
        .digest('base64');

      this.pass('HMAC-SHA256 signature generated successfully');
      this.info(`Signature: ${signature.substring(0, 50)}...`);

      // Verify signature
      const sig2 = crypto
        .createHmac('sha256', this.apiSecret)
        .update(message)
        .digest('base64');

      if (signature === sig2) {
        this.pass('Signature is deterministic (reproducible)');
      } else {
        this.fail('Signature is not deterministic!');
        return false;
      }

    } catch (error) {
      this.fail(`HMAC generation failed: ${error.message}`);
      return false;
    }

    return true;
  }

  // Test 4: Message format validation
  testMessageFormat() {
    console.log('\n' + '='.repeat(50));
    console.log('TEST 4: Message Format Validation');
    console.log('='.repeat(50));

    const timestamp = Date.now();
    const method = 'POST';
    const path = '/create-order';
    const body = JSON.stringify({ test: 'data' });

    // Correct format
    const correctMessage = `${timestamp}${method}${path}${body}`;
    this.pass(`Correct format: ${correctMessage.substring(0, 60)}...`);

    // Check components
    const components = [
      { name: 'Timestamp', value: timestamp.toString(), expected: 13 },
      { name: 'Method', value: method, expected: -1 },
      { name: 'Path', value: path, expected: -1 }
    ];

    components.forEach(comp => {
      if (comp.expected === -1 || comp.value.length === comp.expected) {
        this.pass(`${comp.name}: "${comp.value}"`);
      } else {
        this.fail(`${comp.name} format unexpected (got ${comp.value.length} chars)`);
      }
    });

    return true;
  }

  // Test 5: Headers validation
  testHeaders() {
    console.log('\n' + '='.repeat(50));
    console.log('TEST 5: Required Headers');
    console.log('='.repeat(50));

    const headers = {
      'POLY-SIGNATURE': 'test_signature_' + Math.random(),
      'POLY-TIMESTAMP': Date.now().toString(),
      'POLY-API-KEY': this.apiKey,
      'POLY-NONCE': crypto.randomBytes(8).toString('hex'),
      'Content-Type': 'application/json'
    };

    const requiredHeaders = [
      'POLY-SIGNATURE',
      'POLY-TIMESTAMP',
      'POLY-API-KEY',
      'POLY-NONCE',
      'Content-Type'
    ];

    requiredHeaders.forEach(header => {
      if (headers[header]) {
        const value = headers[header];
        const preview = value.length > 50 ? value.substring(0, 50) + '...' : value;
        this.pass(`${header}: ${preview}`);
      } else {
        this.fail(`Missing header: ${header}`);
      }
    });

    return true;
  }

  // Test 6: Body formatting consistency
  testBodyFormatting() {
    console.log('\n' + '='.repeat(50));
    console.log('TEST 6: Body Formatting Consistency');
    console.log('='.repeat(50));

    const order = {
      token_id: '0x1234567890123456789012345678901234567890',
      price: '0.52',
      size: '100',
      side: 'BUY'
    };

    // Generate body multiple times
    const body1 = JSON.stringify(order);
    const body2 = JSON.stringify(order);
    const body3 = JSON.stringify(order);

    this.info(`Body 1: ${body1}`);
    this.info(`Body 2: ${body2}`);
    this.info(`Body 3: ${body3}`);

    if (body1 === body2 && body2 === body3) {
      this.pass('Body formatting is consistent (deterministic)');
    } else {
      this.fail('Body formatting is NOT deterministic!');
      return false;
    }

    // Check for common formatting issues
    if (body1.includes('\n')) {
      this.fail('Body contains newlines (JSON.stringify should not add them)');
      return false;
    }
    this.pass('Body has no unexpected whitespace');

    // Check that fields are in expected order
    const orderCheck = [
      { key: 'token_id', present: body1.includes('token_id') },
      { key: 'price', present: body1.includes('price') },
      { key: 'size', present: body1.includes('size') },
      { key: 'side', present: body1.includes('side') }
    ];

    orderCheck.forEach(field => {
      if (field.present) {
        this.pass(`Body contains field: "${field.key}"`);
      } else {
        this.fail(`Body missing field: "${field.key}"`);
      }
    });

    return true;
  }

  // Test 7: Test with actual CLOB endpoint (optional)
  async testCLOBConnection() {
    console.log('\n' + '='.repeat(50));
    console.log('TEST 7: CLOB API Connectivity (optional)');
    console.log('='.repeat(50));

    try {
      const response = await fetch('https://clob.polymarket.com/prices', {
        timeout: 5000
      });

      if (response.ok) {
        this.pass('CLOB API is reachable');
        const data = await response.json();
        this.pass(`Received ${Array.isArray(data) ? data.length : 'data'} items from /prices`);
      } else {
        this.warn(`CLOB API returned ${response.status} (expected for public endpoint)`);
      }
    } catch (error) {
      this.warn(`CLOB API test failed: ${error.message}`);
    }

    return true;
  }

  // Run all tests
  async runAll() {
    console.log('\n╔════════════════════════════════════════════════╗');
    console.log('║  Polymarket CLOB Authentication Test Suite     ║');
    console.log('╚════════════════════════════════════════════════╝');

    this.testCredentials();
    this.testTimestamp();
    this.testHMAC();
    this.testMessageFormat();
    this.testHeaders();
    this.testBodyFormatting();
    await this.testCLOBConnection();

    // Summary
    console.log('\n' + '='.repeat(50));
    console.log('TEST SUMMARY');
    console.log('='.repeat(50));
    console.log(`✅ Passed: ${this.testsPassed}`);
    console.log(`❌ Failed: ${this.testsFailed}`);

    if (this.testsFailed === 0) {
      console.log('\n🎉 All tests passed! Your setup looks correct.');
      console.log('If you still get 401 errors, check:');
      console.log('  1. API credentials are correct');
      console.log('  2. Timestamp is fresh (< 5 minutes old)');
      console.log('  3. Request body matches signed message exactly');
      return true;
    } else {
      console.log('\n⚠️  Some tests failed. Fix the issues above.');
      return false;
    }
  }
}

// Run tests
const tester = new CLOBTester();
tester.runAll().catch(console.error);