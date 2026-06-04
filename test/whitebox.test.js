#!/usr/bin/env node
// Whitebox unit tests for steamdt-mcp lib.js
// Tests all pure functions: env, cache, search, dispatch
// Run: node test/whitebox.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const lib = require('../src/lib');

let passed = 0;
let failed = 0;
const asyncTests = [];

function test(name, fn) {
  if (fn.constructor.name === 'AsyncFunction') {
    asyncTests.push({ name, fn });
    return;
  }
  try {
    fn();
    passed++;
    process.stdout.write(`  ✓ ${name}\n`);
  } catch (err) {
    failed++;
    process.stdout.write(`  ✗ ${name}\n`);
    process.stderr.write(`    ${err.message}\n`);
  }
}

function assertEqual(actual, expected, msg) {
  if (Array.isArray(expected) && Array.isArray(actual)) {
    assert.deepStrictEqual(actual, expected, msg);
  } else if (typeof expected === 'object' && expected !== null && typeof actual === 'object' && actual !== null) {
    assert.deepStrictEqual(actual, expected, msg);
  } else {
    assert.strictEqual(actual, expected, msg);
  }
}

// ── .env Loader Tests ────────────────────────────────────────────────────────
process.stdout.write('\n.env Loader\n');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'steamdt-test-'));
const envFile = path.join(tmpDir, '.env');

test('loads key=value', () => {
  fs.writeFileSync(envFile, 'FOO=bar\n');
  delete process.env.FOO;
  lib.loadEnvFile(envFile);
  assertEqual(process.env.FOO, 'bar');
});

test('skips comments and blanks', () => {
  fs.writeFileSync(envFile, '# comment\n\nKEY1=val1\n\n\nKEY2=val2\n');
  delete process.env.KEY1;
  delete process.env.KEY2;
  lib.loadEnvFile(envFile);
  assertEqual(process.env.KEY1, 'val1');
  assertEqual(process.env.KEY2, 'val2');
});

test('strips double quotes', () => {
  fs.writeFileSync(envFile, 'QUOTED="hello world"\n');
  delete process.env.QUOTED;
  lib.loadEnvFile(envFile);
  assertEqual(process.env.QUOTED, 'hello world');
});

test('strips single quotes', () => {
  fs.writeFileSync(envFile, "QUOTED='hello world'\n");
  delete process.env.QUOTED;
  lib.loadEnvFile(envFile);
  assertEqual(process.env.QUOTED, 'hello world');
});

test('does not overwrite existing env', () => {
  process.env.EXISTING = 'original';
  fs.writeFileSync(envFile, 'EXISTING=newvalue\n');
  lib.loadEnvFile(envFile);
  assertEqual(process.env.EXISTING, 'original');
});

test('returns false for missing file', () => {
  const result = lib.loadEnvFile('/nonexistent/path/.env');
  assertEqual(result, false);
});

// ── Cache Tests ──────────────────────────────────────────────────────────────
process.stdout.write('\nCache\n');

const cacheDir = path.join(tmpDir, '.cache');
lib.ensureCacheDir(cacheDir);

test('loadCache returns null for empty dir', () => {
  const result = lib.loadBaseInfoCache(cacheDir);
  assertEqual(result, null);
});

const sampleCache = { success: true, errorCode: 0, data: [{ name: 'AK-47 | Redline', marketHashName: 'AK-47 | Redline (Field-Tested)', platformList: [{ name: 'BUFF', itemId: '123' }] }] };

test('save and load roundtrip', () => {
  lib.saveBaseInfoCache(cacheDir, sampleCache);
  const loaded = lib.loadBaseInfoCache(cacheDir);
  assertEqual(loaded.data.length, 1);
  assertEqual(loaded.data[0].name, 'AK-47 | Redline');
});

test('loadCache rejects invalid JSON', () => {
  const brokenPath = path.join(cacheDir, 'base_info_broken.json');
  const realPath = lib.getBaseInfoCachePath(cacheDir);
  // Write broken JSON to the actual cache file then clean up
  const original = fs.existsSync(realPath) ? fs.readFileSync(realPath) : null;
  fs.writeFileSync(realPath, 'not json');
  const result = lib.loadBaseInfoCache(cacheDir);
  assertEqual(result, null);
  if (original) fs.writeFileSync(realPath, original);
});

test('loadCache rejects empty data array', () => {
  const realPath = lib.getBaseInfoCachePath(cacheDir);
  const original = fs.existsSync(realPath) ? fs.readFileSync(realPath) : null;
  fs.writeFileSync(realPath, JSON.stringify({ success: true, data: [] }));
  const result = lib.loadBaseInfoCache(cacheDir);
  assertEqual(result, null);
  if (original) fs.writeFileSync(realPath, original);
});

test('loadCache rejects missing success field', () => {
  const realPath = lib.getBaseInfoCachePath(cacheDir);
  const original = fs.existsSync(realPath) ? fs.readFileSync(realPath) : null;
  fs.writeFileSync(realPath, JSON.stringify({ errorCode: 0, data: [{ name: 'x' }] }));
  const result = lib.loadBaseInfoCache(cacheDir);
  assertEqual(result, null);
  if (original) fs.writeFileSync(realPath, original);
});

// ── Search Engine Tests ──────────────────────────────────────────────────────
process.stdout.write('\nSearch Engine\n');

test('normalizeText strips punctuation', () => {
  assertEqual(lib.normalizeText('AK-47 | Redline'), 'ak47redline');
});

test('normalizeText preserves Chinese', () => {
  assertEqual(lib.normalizeText('沙漠之鹰 | 红色'), '沙漠之鹰红色');
});

test('normalizeText handles empty', () => {
  assertEqual(lib.normalizeText(''), '');
});

test('containsAllKeywords single hit', () => {
  assertEqual(lib.containsAllKeywords('redline', 'AK-47 | Redline', 'AK-47 | Redline (Field-Tested)'), true);
});

test('containsAllKeywords single miss', () => {
  assertEqual(lib.containsAllKeywords('dragon', 'AK-47 | Redline', 'AK-47 | Redline (Field-Tested)'), false);
});

test('containsAllKeywords multiple all hit', () => {
  assertEqual(lib.containsAllKeywords('ak redline', 'AK-47 | Redline', 'AK-47 | Redline (Field-Tested)'), true);
});

test('containsAllKeywords multiple partial miss', () => {
  assertEqual(lib.containsAllKeywords('ak howl', 'AK-47 | Redline', 'AK-47 | Redline (Field-Tested)'), false);
});

test('searchItems exact match', () => {
  const cache = { data: [
    { name: 'AK-47 | Redline', marketHashName: 'AK-47 | Redline (Field-Tested)', platformList: [] },
    { name: 'AWP | Dragon Lore', marketHashName: 'AWP | Dragon Lore (Factory New)', platformList: [] },
  ]};
  const result = lib.searchItems('Dragon Lore', cache, 10);
  assertEqual(result.success, true);
  assertEqual(result.count, 1);
  assertEqual(result.data[0].name, 'AWP | Dragon Lore');
});

test('searchItems case insensitive', () => {
  const cache = { data: [
    { name: 'AK-47 | Redline', marketHashName: 'AK-47 | Redline (Field-Tested)', platformList: [] },
  ]};
  const result = lib.searchItems('redline', cache, 10);
  assertEqual(result.success, true);
  assertEqual(result.count, 1);
});

test('searchItems with punctuation-ignoring match', () => {
  const cache = { data: [
    { name: 'USP-S | Kill Confirmed', marketHashName: 'USP-S | Kill Confirmed (Field-Tested)', platformList: [] },
  ]};
  const result = lib.searchItems('usps kill', cache, 10);
  assertEqual(result.success, true);
  assertEqual(result.count, 1);
});

test('searchItems no match', () => {
  const cache = { data: [
    { name: 'AK-47 | Redline', marketHashName: 'AK-47 | Redline (Field-Tested)', platformList: [] },
  ]};
  const result = lib.searchItems('howl', cache, 10);
  assertEqual(result.success, true);
  assertEqual(result.count, 0);
});

test('searchItems no cache returns error', () => {
  const result = lib.searchItems('ak', null, 10);
  assertEqual(result.success, false);
  assertEqual(result.count, 0);
});

test('searchItems respects limit', () => {
  const cache = { data: [
    { name: 'Item 1', marketHashName: 'Item 1', platformList: [] },
    { name: 'Item 2', marketHashName: 'Item 2', platformList: [] },
    { name: 'Item 3', marketHashName: 'Item 3', platformList: [] },
    { name: 'Item 4', marketHashName: 'Item 4', platformList: [] },
  ]};
  const result = lib.searchItems('item', cache, 2);
  assertEqual(result.success, true);
  assertEqual(result.count, 2);
});

test('searchItems skips malformed items', () => {
  const cache = { data: [
    { notName: 'bad' },
    null,
    { name: 'AK-47 | Redline', marketHashName: 'AK-47 | Redline (Field-Tested)', platformList: [] },
  ]};
  const result = lib.searchItems('redline', cache, 10);
  assertEqual(result.success, true);
  assertEqual(result.count, 1);
});

// ── Tool Dispatch Tests (should not bomb) ────────────────────────────────────
process.stdout.write('\nTool Dispatch\n');

const mockCfg = { apiBase: 'https://example.com', apiKey: 'fake', timeoutMs: 1000, maxRetries: 0 };

test('dispatchTool handles unknown tool', async () => {
  const result = await lib.dispatchTool(mockCfg, cacheDir, 'nonexistent_tool', {});
  assertEqual(result.success, false);
  assertEqual(result.errorCode, -99);
});

test('dispatchTool get_price_batch validates empty array', async () => {
  const result = await lib.dispatchTool(mockCfg, cacheDir, 'steamdt_get_price_batch', { marketHashNames: [] });
  assertEqual(result.success, false);
  assertEqual(result.errorCode, -4);
});

test('dispatchTool get_price_batch validates over 100 limit', async () => {
  const names = Array.from({ length: 101 }, (_, i) => `item_${i}`);
  const result = await lib.dispatchTool(mockCfg, cacheDir, 'steamdt_get_price_batch', { marketHashNames: names });
  assertEqual(result.success, false);
  assertEqual(result.errorCode, -5);
});

test('dispatchTool special_styles returns lookup', async () => {
  const result = await lib.dispatchTool(mockCfg, cacheDir, 'steamdt_special_styles', {});
  assertEqual(result.success, true);
  assertEqual(typeof result.data, 'object');
  assertEqual(result.data.RANK['1st'], '一档');
});

test('dispatchTool special_styles has all groups', async () => {
  const result = await lib.dispatchTool(mockCfg, cacheDir, 'steamdt_special_styles', {});
  const groups = Object.keys(result.data);
  assertEqual(groups.length >= 6, true);
  ['RANK', 'TIER', 'PHASE', 'CRIMSON_KIMONO'].forEach(g => {
    assertEqual(groups.includes(g), true, `Missing group: ${g}`);
  });
});

test('dispatchTool search_by_name without cache', async () => {
  const emptyDir = path.join(tmpDir, 'empty-cache');
  const result = await lib.dispatchTool(mockCfg, emptyDir, 'steamdt_search_item_by_name', { query: 'ak' });
  assertEqual(result.success, false);
  assertEqual(result.data.length, 0);
});

// ── apiRequest Error Handling ────────────────────────────────────────────────
process.stdout.write('\nHTTP Error Handling\n');

test('apiRequest catches parse error gracefully', async () => {
  const badCfg = { ...mockCfg, apiBase: 'https://httpbin.org' }; // returns non-standard JSON
  const result = await lib.apiRequest(badCfg, 'GET', '/html', null, null, 0);
  assertEqual(result.success, false);
  // _httpStatus should be present or the request errored (both acceptable for bad HTTP)
  assert(result._httpStatus !== undefined || result.errorCode === -3, 'Should have status or network error');
});

// ── Cleanup ──────────────────────────────────────────────────────────────────
fs.rmSync(tmpDir, { recursive: true, force: true });

// ── Run async tests and summary ─────────────────────────────────────────────
(async () => {
  for (const { name, fn } of asyncTests) {
    try {
      await fn();
      passed++;
      process.stdout.write(`  ✓ ${name}\n`);
    } catch (err) {
      failed++;
      process.stdout.write(`  ✗ ${name}\n`);
      process.stderr.write(`    ${err.message}\n`);
    }
  }
  process.stdout.write(`\n${'='.repeat(50)}\n`);
  const total = passed + failed;
  process.stdout.write(`Whitebox Tests: ${total} total | ${passed} passed | ${failed} failed\n`);
  if (failed > 0) process.exit(1);
})();
