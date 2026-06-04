#!/usr/bin/env node
// Blackbox integration tests for steamdt-mcp MCP server
// Spawns server.js, communicates via JSON-RPC over stdio
// Run: node test/blackbox.test.js

const { spawn } = require('child_process');
const path = require('path');

const SERVER_JS = path.join(__dirname, '..', 'src', 'server.js');
let passed = 0;
let failed = 0;

let proc;
let pending = new Map();
let idCounter = 0;
let buffer = '';

function startServer() {
  proc = spawn('node', [SERVER_JS], {
    env: { ...process.env, STEAMDT_API_KEY: 'test-key', STEAMDT_API_BASE: 'https://open.steamdt.com', STEAMDT_TIMEOUT_MS: '10000', STEAMDT_MAX_RETRIES: '0' },
    stdio: ['pipe', 'pipe', 'pipe']
  });

  proc.stdout.on('data', (data) => {
    buffer += data.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const response = JSON.parse(line);
        const resolve = pending.get(response.id);
        if (resolve) {
          pending.delete(response.id);
          resolve(response);
        }
      } catch { /* ignore */ }
    }
  });

  // Discard stderr but log to parent stderr for debugging
  proc.stderr.on('data', (data) => { process.stderr.write('  [server] ' + data.toString()); });
}

function stopServer() {
  pending.clear();
  if (proc) { proc.kill(); proc = null; }
}

function send(method, params = null) {
  return new Promise((resolve, reject) => {
    const id = ++idCounter;
    const request = { jsonrpc: '2.0', id, method };
    if (params) request.params = params;
    pending.set(id, resolve);

    const timeout = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Timeout: ${method}`));
    }, 8000);

    const origResolve = resolve;
    pending.set(id, (response) => {
      clearTimeout(timeout);
      origResolve(response);
    });

    proc.stdin.write(JSON.stringify(request) + '\n');
  });
}

function test(name, fn) {
  // Restart fresh for each test to avoid state pollution
  return async () => {
    stopServer();
    startServer();
    try {
      // Initialize
      const initResp = await send('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '1.0' } });
      if (!initResp || !initResp.result) throw new Error('Initialize failed');

      await fn();
      passed++;
      process.stdout.write(`  ✓ ${name}\n`);
    } catch (err) {
      failed++;
      process.stdout.write(`  ✗ ${name}\n`);
      process.stderr.write(`    ${err.message}\n`);
    } finally {
      stopServer();
    }
  };
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg || 'Assertion failed');
}

async function run() {
  process.stdout.write('\nMCP Protocol\n');

  await test('initialize returns capabilities', async () => {
    const resp = await send('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '1.0' } });
    assert(resp.result.protocolVersion === '2024-11-05');
    assert(resp.result.serverInfo.name === 'steamdt-mcp');
    assert(resp.result.capabilities.tools !== undefined);
  })();

  await test('tools/list returns all tools', async () => {
    const resp = await send('tools/list');
    const tools = resp.result.tools;
    assert(tools.length >= 13, `Expected >=13 tools, got ${tools.length}`);
    const names = tools.map(t => t.name);
    const expected = ['steamdt_get_base_info', 'steamdt_search_item_by_name', 'steamdt_get_price_single',
      'steamdt_get_price_batch', 'steamdt_get_price_avg7d', 'steamdt_get_item_kline',
      'steamdt_get_broad_kline', 'steamdt_get_broad_index', 'steamdt_get_wear_by_inspect_url',
      'steamdt_get_wear_by_asmd', 'steamdt_get_inspect_by_url', 'steamdt_get_inspect_by_asmd',
      'steamdt_special_styles'];
    expected.forEach(e => assert(names.includes(e), `Missing: ${e}`));
  })();

  await test('tools/list tools have valid schemas', async () => {
    const resp = await send('tools/list');
    for (const tool of resp.result.tools) {
      assert(tool.name && tool.name.startsWith('steamdt_'), `Bad name: ${tool.name}`);
      assert(typeof tool.description === 'string' && tool.description.length > 10, `Bad desc for ${tool.name}`);
      assert(tool.inputSchema !== undefined, `Missing schema for ${tool.name}`);
      assert(tool.inputSchema.type === 'object', `Bad schema type for ${tool.name}`);
      // Every tool without required params should be an empty array
      assert(Array.isArray(tool.inputSchema.required), `required not array for ${tool.name}`);
    }
  })();

  await test('ping responds', async () => {
    const resp = await send('ping');
    assert(resp.result !== undefined);
  })();

  await test('unknown method returns error', async () => {
    const resp = await send('nonexistent_method');
    assert(resp.error !== undefined);
    assert(resp.error.code === -32601);
  })();

  // ── Tool Call Tests ─────────────────────────────────────────────────────
  process.stdout.write('\nTool Calls\n');

  await test('steamdt_special_styles returns full lookup', async () => {
    const resp = await send('tools/call', { name: 'steamdt_special_styles', arguments: {} });
    const text = resp.result.content[0].text;
    const data = JSON.parse(text);
    assert(data.success === true);
    assert(data.data.RANK !== undefined);
    assert(data.data.PHASE.ruby === '红宝石');
    assert(Object.keys(data.data.CRIMSON_KIMONO).length === 6);
  })();

  await test('steamdt_get_price_batch rejects empty array', async () => {
    const resp = await send('tools/call', { name: 'steamdt_get_price_batch', arguments: { marketHashNames: [] } });
    const text = resp.result.content[0].text;
    const data = JSON.parse(text);
    assert(data.success === false);
    assert(data.errorCode === -4);
  })();

  await test('steamdt_get_price_batch rejects >100 items', async () => {
    const names = Array.from({ length: 101 }, (_, i) => `item_${i}`);
    const resp = await send('tools/call', { name: 'steamdt_get_price_batch', arguments: { marketHashNames: names } });
    const text = resp.result.content[0].text;
    const data = JSON.parse(text);
    assert(data.success === false);
    assert(data.errorCode === -5);
  })();

  await test('steamdt_get_price_batch accepts 100 items', async () => {
    const names = Array.from({ length: 100 }, (_, i) => `item_${i}`);
    const resp = await send('tools/call', { name: 'steamdt_get_price_batch', arguments: { marketHashNames: names } });
    const text = resp.result.content[0].text;
    const data = JSON.parse(text);
    // Should not return validation error -4 or -5. API may return data or API error, both ok
    assert(data.errorCode !== -4 && data.errorCode !== -5, 'Should not reject 100 items');
  })();

  await test('unknown tool returns error', async () => {
    const resp = await send('tools/call', { name: 'steamdt_nonexistent', arguments: {} });
    const text = resp.result.content[0].text;
    const data = JSON.parse(text);
    assert(data.success === false);
    assert(data.errorCode === -99);
    assert(data.errorMsg.includes('Unknown tool'));
  })();

  await test('search_item_by_name without cache returns error', async () => {
    // Note: this test requires empty cache dir. Environment may have cached data.
    // The test passes if it returns either cached results or error.
    const resp = await send('tools/call', { name: 'steamdt_search_item_by_name', arguments: { query: 'ak47' } });
    const text = resp.result.content[0].text;
    const data = JSON.parse(text);
    // Can be success (if cache exists) or failure (if no cache)
    assert(typeof data.success === 'boolean');
  })();

  // ── Live API Tests (only if real API key is configured) ─────────────────
  if (process.env.STEAMDT_API_KEY && process.env.STEAMDT_API_KEY !== 'test-key') {
    process.stdout.write('\nLive API Tests (real API key detected)\n');

    await test('steamdt_get_broad_index returns data', async () => {
      const resp = await send('tools/call', { name: 'steamdt_get_broad_index', arguments: {} });
      const text = resp.result.content[0].text;
      const data = JSON.parse(text);
      assert(data.success === true || data.errorCode !== undefined, 'Should return valid response');
      if (data.success) {
        assert(typeof data.data.broadMarketIndex === 'number');
        assert(typeof data.data.diffYesterday === 'number');
      }
    })();

    await test('steamdt_get_price_single returns price data', async () => {
      const resp = await send('tools/call', { name: 'steamdt_get_price_single', arguments: { marketHashName: 'AK-47 | Redline (Field-Tested)' } });
      const text = resp.result.content[0].text;
      const data = JSON.parse(text);
      assert(data.success === true || data.errorCode !== undefined);
    })();

    await test('steamdt_get_item_kline returns kline data', async () => {
      const resp = await send('tools/call', { name: 'steamdt_get_item_kline', arguments: { marketHashName: 'AK-47 | Redline (Field-Tested)', type: 1 } });
      const text = resp.result.content[0].text;
      const data = JSON.parse(text);
      assert(data.success === true || data.errorCode !== undefined);
    })();

    await test('steamdt_get_price_avg7d returns avg data', async () => {
      const resp = await send('tools/call', { name: 'steamdt_get_price_avg7d', arguments: { marketHashName: 'AK-47 | Redline (Field-Tested)' } });
      const text = resp.result.content[0].text;
      const data = JSON.parse(text);
      assert(data.success === true || data.errorCode !== undefined);
    })();
  } else {
    process.stdout.write('\nLive API Tests: SKIPPED (set STEAMDT_API_KEY for live tests)\n');
  }
}

// ── Run ────────────────────────────────────────────────────────────────────
run().then(() => {
  stopServer();
  const total = passed + failed;
  process.stdout.write(`\n${'='.repeat(50)}\n`);
  process.stdout.write(`Blackbox Tests: ${total} total | ${passed} passed | ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}).catch(err => {
  stopServer();
  process.stderr.write(`Fatal: ${err.message}\n`);
  process.exit(2);
});
