#!/usr/bin/env node

const readline = require('readline');
const lib = require('./lib');

// ── Load .env ──────────────────────────────────────────────────────────────
const envPath = lib.tryLoadEnv();
if (envPath) process.stderr.write(`Loaded .env from ${envPath}\n`);

// ── Config ──────────────────────────────────────────────────────────────────
const cfg = lib.getConfig();
const SERVER_NAME = 'steamdt-mcp';
const SERVER_VERSION = '2.1.0';
const PROTOCOL_VERSION = '2024-11-05';
const CACHE_DIR = cfg.cacheDir;

// ── Tool Definitions ─────────────────────────────────────────────────────────
const TOOLS = [
  {
    name: 'steamdt_get_base_info',
    description: '获取 SteamDT 全量 CS2 饰品基础信息列表（含 marketHashName、各平台 itemId）。每天限调用 1 次，结果自动缓存到本地，后续调用优先使用缓存。',
    inputSchema: { type: 'object', properties: { forceRefresh: { type: 'boolean', description: '是否强制刷新缓存（忽略本地缓存重新调用API）' } }, required: [] }
  },
  {
    name: 'steamdt_search_item_by_name',
    description: '根据中文名或英文名模糊搜索饰品，返回匹配的 marketHashName。需要先调用 steamdt_get_base_info 建立缓存。',
    inputSchema: { type: 'object', properties: { query: { type: 'string', description: '搜索关键词（中英文均可，支持分词）' }, limit: { type: 'integer', description: '返回数量上限，默认 10', default: 10 } }, required: ['query'] }
  },
  {
    name: 'steamdt_get_price_single',
    description: '通过 marketHashName 查询单品在各平台的在售/求购价格。频率限制 60次/分钟。',
    inputSchema: { type: 'object', properties: { marketHashName: { type: 'string', description: 'Steam 官方饰品名称，可从 base_info 获取' } }, required: ['marketHashName'] }
  },
  {
    name: 'steamdt_get_price_batch',
    description: '批量查询饰品在各平台的在售/求购价格。最多 100 个。频率限制 1次/分钟。',
    inputSchema: { type: 'object', properties: { marketHashNames: { type: 'array', items: { type: 'string' }, description: '饰品名称数组，最少1个，最多100个' } }, required: ['marketHashNames'] }
  },
  {
    name: 'steamdt_get_price_avg7d',
    description: '通过 marketHashName 查询饰品近7天所有平台的均价及各平台单独均价。也支持 days 参数查询更多天数。',
    inputSchema: { type: 'object', properties: { marketHashName: { type: 'string', description: 'Steam 官方饰品名称' }, days: { type: 'integer', description: '回溯天数，默认 7。例如 7、30、90' } }, required: ['marketHashName'] }
  },
  {
    name: 'steamdt_get_item_kline',
    description: '查询饰品 K 线数据（不含成交量）。频率限制 120次/分钟。',
    inputSchema: { type: 'object', properties: { marketHashName: { type: 'string', description: '饰品名称', minLength: 1, maxLength: 100 }, type: { type: 'integer', description: 'K线类型：1-3', minimum: 1, maximum: 3 }, platform: { type: 'string', description: '平台筛选（可选）。ALL/BUFF/YOUPIN/C5/STEAM/HALOSKINS' }, specialStyle: { type: 'string', description: '特殊款式（可选），参考 steamdt_special_styles 中的值' } }, required: ['marketHashName', 'type'] }
  },
  {
    name: 'steamdt_get_broad_kline',
    description: '查询 CS2 大盘 K 线数据（不含成交量）。',
    inputSchema: { type: 'object', properties: { type: { type: 'integer', description: 'K线类型：1-3', minimum: 1, maximum: 3 } }, required: ['type'] }
  },
  {
    name: 'steamdt_get_broad_index',
    description: '查询 CS2 大盘最新指数，含涨跌值和历史记录。',
    inputSchema: { type: 'object', properties: {}, required: [] }
  },
  {
    name: 'steamdt_get_wear_by_inspect_url',
    description: '通过检视链接查询饰品磨损度及相关数据（含贴纸/挂件/浮值）。支持同步和异步回调。频率限制 36000次/时。',
    inputSchema: { type: 'object', properties: { inspectUrl: { type: 'string', description: 'Steam CS2 检视链接 (steam://rungame/730/...)' }, notifyUrl: { type: 'string', description: '异步回调地址（可选）。不填则等待同步返回' } }, required: ['inspectUrl'] }
  },
  {
    name: 'steamdt_get_wear_by_asmd',
    description: '通过 ASMD 参数查询饰品磨损度（替代检视链接方式）。频率限制 36000次/时。',
    inputSchema: { type: 'object', properties: { s: { type: 'integer', description: 'ASMD 参数 S' }, m: { type: 'integer', description: 'ASMD 参数 M' }, a: { type: 'integer', description: 'ASMD 参数 A' }, d: { type: 'string', description: 'ASMD 参数 D' }, notifyUrl: { type: 'string', description: '异步回调地址（可选）' } }, required: [] }
  },
  {
    name: 'steamdt_get_inspect_by_url',
    description: '通过检视链接生成饰品 2D 检视图（需先获取磨损度数据）。频率限制 100次/天（稀缺资源）。',
    inputSchema: { type: 'object', properties: { inspectUrl: { type: 'string', description: 'Steam CS2 检视链接' }, notifyUrl: { type: 'string', description: '异步回调地址（可选）' } }, required: ['inspectUrl'] }
  },
  {
    name: 'steamdt_get_inspect_by_asmd',
    description: '通过 ASMD 参数生成饰品 2D 检视图（需先获取磨损度数据）。频率限制 100次/天（稀缺资源）。',
    inputSchema: { type: 'object', properties: { s: { type: 'integer', description: 'ASMD 参数 S' }, m: { type: 'integer', description: 'ASMD 参数 M' }, a: { type: 'integer', description: 'ASMD 参数 A' }, d: { type: 'string', description: 'ASMD 参数 D' }, notifyUrl: { type: 'string', description: '异步回调地址（可选）' } }, required: [] }
  },
  {
    name: 'steamdt_special_styles',
    description: '获取 CS2 饰品特殊款式对照表（档位/阶段/多普勒相位/宝石/绯红和服等）。用于分析磨损数据中的 paintseed 和特殊款式字段。',
    inputSchema: { type: 'object', properties: {}, required: [] }
  }
];

// ── MCP JSON-RPC Protocol ────────────────────────────────────────────────────
const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: false });

function send(id, result) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
}

function sendErr(id, code, message) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }) + '\n');
}

async function handleRequest(req) {
  const { jsonrpc, id, method, params } = req;
  if (jsonrpc !== '2.0') { sendErr(id || null, -32600, 'Invalid Request'); return; }
  if (id === undefined || id === null) return;

  switch (method) {
    case 'initialize':
      send(id, { protocolVersion: PROTOCOL_VERSION, capabilities: { tools: {} }, serverInfo: { name: SERVER_NAME, version: SERVER_VERSION } });
      break;
    case 'tools/list':
      send(id, { tools: TOOLS });
      break;
    case 'tools/call':
      try {
        const result = await lib.dispatchTool(cfg, CACHE_DIR, params.name, params.arguments || {});
        send(id, { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] });
      } catch (err) {
        send(id, { content: [{ type: 'text', text: JSON.stringify({ success: false, errorMsg: err.message }) }], isError: true });
      }
      break;
    case 'ping':
      send(id, {});
      break;
    default:
      sendErr(id, -32601, `Method not found: ${method}`);
  }
}

rl.on('line', (line) => {
  try { handleRequest(JSON.parse(line.trim())); }
  catch { sendErr(null, -32700, 'Parse error'); }
});

process.stderr.write(`${SERVER_NAME} v${SERVER_VERSION} started\n`);
process.stderr.write(`Base: ${cfg.apiBase} | Key: ${cfg.apiKey ? 'configured' : 'MISSING'}\n`);
process.stderr.write(`Cache: ${CACHE_DIR}\n`);
