// Renders meme.html to meme.png with the headless Chromium on this machine.
//
// The page is served through the CDP Fetch domain under a public-looking
// origin (https://meme.local/) because this Chromium build refuses to load
// pages from loopback origins. The HTML is fully self-contained, so the one
// document request is fulfilled with the file's own bytes.

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, 'meme.html'));
const outFile = join(here, 'meme.png');
const ORIGIN = 'https://meme.local/meme.html';
const PORT = 9333;

// This Chromium build wants its WebGL domain policy file and that file's hash.
const policy = Buffer.from('hatch-webgl-all-origins-v1\n');
writeFileSync('/tmp/hatch-webgl-policy.txt', policy);
const policyHash = createHash('sha256').update(policy).digest('hex');

const chrome = spawn('/opt/meta-chromium/chrome', [
  '--headless=new',
  '--disable-gpu',
  '--no-sandbox',
  '--hide-scrollbars',
  `--remote-debugging-port=${PORT}`,
  `--hatch-webgl-allowed-domains-file=/tmp/hatch-webgl-policy.txt`,
  `--hatch-webgl-allowed-domains-sha256=${policyHash}`,
  'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe'] });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function wsUrl() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      const json = await res.json();
      if (json.webSocketDebuggerUrl) return json.webSocketDebuggerUrl;
    } catch { /* not up yet */ }
    await sleep(250);
  }
  throw new Error('Chromium debugging endpoint never came up');
}

let nextId = 1;
const pending = new Map();
const listeners = [];
function send(ws, method, params = {}, sessionId) {
  const id = nextId++;
  const msg = { id, method, params };
  if (sessionId) msg.sessionId = sessionId;
  ws.send(JSON.stringify(msg));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}
function onEvent(fn) { listeners.push(fn); }

try {
  const ws = new WebSocket(await wsUrl());
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
    } else if (msg.method) {
      for (const fn of listeners) fn(msg);
    }
  });

  const { targetId } = await send(ws, 'Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send(ws, 'Target.attachToTarget', { targetId, flatten: true });

  await send(ws, 'Page.enable', {}, sessionId);
  await send(ws, 'Fetch.enable', { patterns: [{ urlPattern: 'https://meme.local/*' }] }, sessionId);
  onEvent(async (msg) => {
    if (msg.method === 'Fetch.requestPaused' && msg.sessionId === sessionId) {
      await send(ws, 'Fetch.fulfillRequest', {
        requestId: msg.params.requestId,
        responseCode: 200,
        responseHeaders: [{ name: 'Content-Type', value: 'text/html; charset=utf-8' }],
        body: html.toString('base64'),
      }, sessionId);
    }
  });

  await send(ws, 'Emulation.setDeviceMetricsOverride',
    { width: 1200, height: 1200, deviceScaleFactor: 1, mobile: false }, sessionId);
  await send(ws, 'Page.navigate', { url: ORIGIN }, sessionId);
  await sleep(1600); // fonts and first paint

  const shot = await send(ws, 'Page.captureScreenshot',
    { format: 'png', clip: { x: 0, y: 0, width: 1200, height: 1200, scale: 1 } }, sessionId);
  writeFileSync(outFile, Buffer.from(shot.data, 'base64'));
  console.log('wrote', outFile);
  ws.close();
} finally {
  chrome.kill('SIGKILL');
}
