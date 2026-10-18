// Smoke test: FoxDen exposes the same tools as Playwright MCP and drives the installed Firefox.
// Usage: npm test            (uses the active profile)
//        npm test -- --caps=vision,pdf,devtools

import { createRequire } from 'module';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const extraArgs = process.argv.slice(2);
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'foxden-test-'));

let failures = 0;
const check = (condition, message) => {
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${message}`);
  if (!condition)
    failures++;
};

async function connect(command, args) {
  const transport = new StdioClientTransport({ command, args, cwd: workDir, stderr: 'pipe' });
  const client = new Client({ name: 'foxden-smoke-test', version: '1.0.0' });
  await client.connect(transport);
  return client;
}

const text = result => result.content.filter(c => c.type === 'text').map(c => c.text).join('\n');

// 1. Tool parity with upstream Playwright MCP (same flags).
const upstreamCli = path.join(path.dirname(require.resolve('@playwright/mcp/package.json')), 'cli.js');
const upstream = await connect(process.execPath, [upstreamCli, ...extraArgs]);
const upstreamTools = (await upstream.listTools()).tools.map(t => t.name).sort();
await upstream.close();

const foxden = await connect(process.execPath, [path.join(root, 'bin', 'foxden-mcp.js'), ...extraArgs]);
const foxdenTools = (await foxden.listTools()).tools.map(t => t.name).sort();
const missing = upstreamTools.filter(t => !foxdenTools.includes(t));
check(missing.length === 0 && foxdenTools.length === upstreamTools.length,
    `same ${foxdenTools.length} tools as Playwright MCP${missing.length ? ` (missing: ${missing.join(', ')})` : ''}`);

// 2. Browser launch and basic tools.
try {
  const nav = await foxden.callTool({ name: 'browser_navigate', arguments: { url: 'https://example.com' } });
  check(!nav.isError && text(nav).includes('Example Domain'), 'browser_navigate opens a page');

  const ua = await foxden.callTool({ name: 'browser_evaluate', arguments: { function: '() => navigator.userAgent' } });
  const isFirefox = /Firefox\/\d+/.test(text(ua));
  check(isFirefox, `browser is Firefox (${(text(ua).match(/Firefox\/[\d.]+/) || ['?'])[0]})`);

  const snap = await foxden.callTool({ name: 'browser_snapshot', arguments: {} });
  check(!snap.isError, 'browser_snapshot works');

  const shot = await foxden.callTool({ name: 'browser_take_screenshot', arguments: { type: 'png' } });
  check(!shot.isError, 'browser_take_screenshot works');

  const tabs = await foxden.callTool({ name: 'browser_tabs', arguments: { action: 'new' } });
  check(!tabs.isError, 'browser_tabs can open a tab');

  const cookies = await foxden.callTool({ name: 'browser_run_code_unsafe', arguments: { code: 'async (page) => (await page.context().cookies()).length' } });
  const count = Number((text(cookies).match(/### Result\s+(\d+)/) || [])[1]);
  check(Number.isFinite(count), `profile is persistent (${count} cookies loaded)`);
} finally {
  await foxden.callTool({ name: 'browser_close', arguments: {} }).catch(() => {});
  await foxden.close();
  fs.rmSync(workDir, { recursive: true, force: true });
}

console.log(failures ? `\n${failures} check(s) failed.` : '\nAll checks passed.');
process.exit(failures ? 1 : 0);
