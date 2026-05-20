#!/usr/bin/env node
/**
 * MBIO Arb Launcher — downloads the latest bot from Base44 and runs it.
 * Env: DROPLET_SECRET, BASE44_APP_URL
 * This file is only a fallback launcher. The real signal engine is in downloadBot.
 */

import 'dotenv/config';
import { spawn } from 'child_process';
import { writeFileSync } from 'fs';

const APP_URL       = process.env.BASE44_APP_URL || 'https://polytrade.base44.app';
const USER_TOKEN    = process.env.BASE44_USER_TOKEN || '';
const DOWNLOAD_URL  = `${APP_URL}/functions/downloadBot`;
const BOT_PATH      = '/opt/arb-bot/bot.mjs';

async function downloadAndStart() {
  console.log('📥 Downloading latest bot from Base44...');
  try {
    const res = await fetch(DOWNLOAD_URL, {
      headers: USER_TOKEN ? { 'Authorization': `Bearer ${USER_TOKEN}` } : {},
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const code = await res.text();
    writeFileSync(BOT_PATH, code, 'utf8');
    console.log(`✅ Bot downloaded (${code.length} bytes) → ${BOT_PATH}`);
  } catch (e) {
    console.error('❌ Download failed:', e.message);
    console.log('⚠️  Running existing bot at', BOT_PATH);
  }

  const proc = spawn('node', [BOT_PATH], {
    stdio: 'inherit',
    env: process.env,
  });
  proc.on('exit', (code) => {
    console.log(`Bot exited (code ${code}), restarting in 5s...`);
    setTimeout(downloadAndStart, 5000);
  });
}

downloadAndStart();