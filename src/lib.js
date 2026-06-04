// SteamDT MCP - Pure function library (testable without MCP protocol)
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

// ── Config ──────────────────────────────────────────────────────────────────
function getConfig() {
  return {
    apiBase: process.env.STEAMDT_API_BASE || 'https://open.steamdt.com',
    apiKey: process.env.STEAMDT_API_KEY || '',
    timeoutMs: parseInt(process.env.STEAMDT_TIMEOUT_MS || '20000', 10),
    maxRetries: parseInt(process.env.STEAMDT_MAX_RETRIES || '2', 10),
    cacheDir: process.env.STEAMDT_CACHE_DIR || path.join(__dirname, '..', '.cache'),
  };
}

// ── .env Loader ─────────────────────────────────────────────────────────────
function loadEnvFile(envPath) {
  if (!fs.existsSync(envPath)) return false;
  const content = fs.readFileSync(envPath, 'utf-8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let value = trimmed.slice(eqIdx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
  return true;
}

function tryLoadEnv() {
  const envPaths = [
    path.join(__dirname, '..', '.env'),
    path.join(process.cwd(), '.env'),
    path.join(process.cwd(), 'steamdt-mcp', '.env'),
  ];
  for (const envPath of envPaths) {
    if (fs.existsSync(envPath)) {
      loadEnvFile(envPath);
      return envPath;
    }
  }
  return null;
}

// ── Special Styles ──────────────────────────────────────────────────────────
const SPECIAL_STYLES = {
  RANK: { '1st': '一档', '2nd': '二档', '3rd': '三档', '4th': '四档', '5th': '五档', '6th': '六档', '7th': '七档', '8th': '八档', '9th': '九档', '10th': '十档' },
  TIER: { 't1': 't1', 't2': 't2', 't3': 't3', 't4': 't4' },
  SUN: { 'sun': '官图太阳' },
  PHASE: { 'p1': 'p1', 'p2': 'p2', 'p3': 'p3', 'p4': 'p4', 'ruby': '红宝石', 'emerald': '绿宝石', 'sapphire': '蓝宝石', 'blackpearl': '黑珍珠' },
  SINGLEBLUE: { 'singleblue': '单面全蓝' },
  CRIMSON_KIMONO: { 'crimson_kimono_p1': '一档', 'crimson_kimono_p2': '二档', 'crimson_kimono_p3': '三档', 'crimson_kimono_p4': '四档', 'crimson_kimono_p5': '五档', 'crimson_kimono_p6': '六档' }
};

// ── Cache Helpers ────────────────────────────────────────────────────────────
function getBaseInfoCachePath(cacheDir) {
  return path.join(cacheDir, 'base_info.json');
}

function ensureCacheDir(cacheDir) {
  if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });
}

function loadBaseInfoCache(cacheDir) {
  const filePath = getBaseInfoCachePath(cacheDir);
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, 'utf-8');
    const data = JSON.parse(raw);
    if (data && data.success && Array.isArray(data.data) && data.data.length > 0) return data;
  } catch { /* ignore */ }
  return null;
}

function saveBaseInfoCache(cacheDir, data) {
  ensureCacheDir(cacheDir);
  fs.writeFileSync(getBaseInfoCachePath(cacheDir), JSON.stringify(data, null, 2), 'utf-8');
}

// ── HTTP Client ──────────────────────────────────────────────────────────────
function apiRequest(cfg, method, urlPath, query, body, retries) {
  const maxRetries = retries !== undefined ? retries : cfg.maxRetries;
  return new Promise((resolve) => {
    const urlObj = new URL(urlPath, cfg.apiBase);
    if (query) {
      Object.entries(query).forEach(([k, v]) => { if (v !== undefined && v !== null) urlObj.searchParams.set(k, v); });
    }

    const options = {
      method: method.toUpperCase(),
      hostname: urlObj.hostname,
      port: urlObj.port,
      path: urlObj.pathname + urlObj.search,
      headers: {
        'Authorization': `Bearer ${cfg.apiKey}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      timeout: cfg.timeoutMs
    };

    const proto = urlObj.protocol === 'https:' ? https : http;
    const req = proto.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ ...JSON.parse(data), _httpStatus: res.statusCode });
        } catch {
          resolve({ success: false, errorCode: -1, errorMsg: `Parse error: ${data.slice(0, 200)}`, _httpStatus: res.statusCode, _raw: data });
        }
      });
    });

    req.on('timeout', () => {
      req.destroy();
      if (maxRetries > 0) resolve(apiRequest(cfg, method, urlPath, query, body, maxRetries - 1));
      else resolve({ success: false, errorCode: -2, errorMsg: 'Request timeout after retries' });
    });

    req.on('error', (err) => {
      if (maxRetries > 0) resolve(apiRequest(cfg, method, urlPath, query, body, maxRetries - 1));
      else resolve({ success: false, errorCode: -3, errorMsg: err.message });
    });

    if (body && method.toUpperCase() === 'POST') req.write(JSON.stringify(body));
    req.end();
  });
}

// ── Search Engine ────────────────────────────────────────────────────────────
function normalizeText(text) {
  return text.toLowerCase().replace(/[^\w\u4e00-\u9fff]/g, '');
}

function containsAllKeywords(query, name, marketHashName) {
  const keywords = query.toLowerCase().split(/\s+/).filter(Boolean);
  const nameLower = name.toLowerCase();
  const mhLower = marketHashName.toLowerCase();
  for (const kw of keywords) {
    if (!nameLower.includes(kw) && !mhLower.includes(kw)) {
      const nQuery = normalizeText(query);
      const nName = normalizeText(name);
      const nMh = normalizeText(marketHashName);
      if (!nName.includes(nQuery) && !nMh.includes(nQuery)) {
        const nKw = normalizeText(kw);
        if (!nName.includes(nKw) && !nMh.includes(nKw)) return false;
      }
    }
  }
  return true;
}

function searchItems(query, cache, limit = 10) {
  if (!cache || !cache.data) return { success: false, errorMsg: 'No cached base info. Call steamdt_get_base_info first.', data: [], count: 0 };

  const matches = [];
  const qLower = query.toLowerCase();
  for (const item of cache.data) {
    if (!item || !item.name || !item.marketHashName) continue;
    const nameLow = item.name.toLowerCase();
    const mhLow = item.marketHashName.toLowerCase();
    if (nameLow.includes(qLower) || mhLow.includes(qLower) ||
        normalizeText(nameLow).includes(normalizeText(qLower)) ||
        containsAllKeywords(query, item.name, item.marketHashName)) {
      matches.push({ name: item.name, marketHashName: item.marketHashName, platformList: item.platformList });
      if (matches.length >= limit) break;
    }
  }
  return { success: true, data: matches, count: matches.length, query };
}

// ── Tool Handlers ────────────────────────────────────────────────────────────
async function handleGetBaseInfo(cfg, cacheDir, args) {
  const forceRefresh = args.forceRefresh === true;
  if (!forceRefresh) {
    const cached = loadBaseInfoCache(cacheDir);
    if (cached) return { ...cached, _cached: true };
  }
  const result = await apiRequest(cfg, 'GET', '/open/cs2/v1/base');

  // API failed — try cache fallback
  if (!result.success || result._httpStatus !== 200) {
    const cached = loadBaseInfoCache(cacheDir);
    if (cached) return { ...cached, _cached: true, _api_error: result.errorMsg || `HTTP ${result._httpStatus}` };
    return result;
  }

  if (result.success && Array.isArray(result.data)) {
    saveBaseInfoCache(cacheDir, result);
  }
  return result;
}

function handleSearchByName(cacheDir, args) {
  const limit = args.limit || 10;
  const cache = loadBaseInfoCache(cacheDir);
  return searchItems(args.query, cache, limit);
}

function handleGetPriceSingle(cfg, args) {
  return apiRequest(cfg, 'GET', '/open/cs2/v1/price/single', { marketHashName: args.marketHashName });
}

function handleGetPriceBatch(cfg, args) {
  const names = args.marketHashNames;
  if (!names || names.length === 0) return Promise.resolve({ success: false, errorCode: -4, errorMsg: 'marketHashNames must be a non-empty array' });
  if (names.length > 100) return Promise.resolve({ success: false, errorCode: -5, errorMsg: 'marketHashNames max 100 items' });
  return apiRequest(cfg, 'POST', '/open/cs2/v1/price/batch', null, { marketHashNames: names });
}

function handleGetPriceAvg7d(cfg, args) {
  const query = { marketHashName: args.marketHashName };
  if (args.days && args.days > 0) query.days = args.days;
  return apiRequest(cfg, 'GET', '/open/cs2/v1/price/avg', query);
}

function handleGetItemKline(cfg, args) {
  const kbody = { marketHashName: args.marketHashName, type: args.type };
  if (args.platform) kbody.platform = args.platform;
  if (args.specialStyle) kbody.specialStyle = args.specialStyle;
  return apiRequest(cfg, 'POST', '/open/cs2/item/v1/kline', null, kbody);
}

function handleGetBroadKline(cfg, args) {
  return apiRequest(cfg, 'POST', '/open/cs2/broad/v1/kline', null, { type: args.type });
}

function handleGetBroadIndex(cfg) {
  return apiRequest(cfg, 'GET', '/open/cs2/broad/v1/index');
}

function handleGetWearByUrl(cfg, args) {
  const wbody = { inspectUrl: args.inspectUrl };
  if (args.notifyUrl) wbody.notifyUrl = args.notifyUrl;
  return apiRequest(cfg, 'POST', '/open/cs2/v1/wear', null, wbody);
}

function handleGetWearByAsmd(cfg, args) {
  const abody = {};
  if (args.s !== undefined) abody.s = args.s;
  if (args.m !== undefined) abody.m = args.m;
  if (args.a !== undefined) abody.a = args.a;
  if (args.d !== undefined) abody.d = args.d;
  if (args.notifyUrl) abody.notifyUrl = args.notifyUrl;
  return apiRequest(cfg, 'POST', '/open/cs2/v2/wear', null, abody);
}

function handleGetInspectByUrl(cfg, args) {
  const ibody = { inspectUrl: args.inspectUrl };
  if (args.notifyUrl) ibody.notifyUrl = args.notifyUrl;
  return apiRequest(cfg, 'POST', '/open/cs2/v1/inspect', null, ibody);
}

function handleGetInspectByAsmd(cfg, args) {
  const asbody = {};
  if (args.s !== undefined) asbody.s = args.s;
  if (args.m !== undefined) asbody.m = args.m;
  if (args.a !== undefined) asbody.a = args.a;
  if (args.d !== undefined) asbody.d = args.d;
  if (args.notifyUrl) asbody.notifyUrl = args.notifyUrl;
  return apiRequest(cfg, 'POST', '/open/cs2/v2/inspect', null, asbody);
}

function handleSpecialStyles() {
  return { success: true, errorCode: 0, errorMsg: '', data: SPECIAL_STYLES };
}

// ── Unified tool dispatcher ─────────────────────────────────────────────────
async function dispatchTool(cfg, cacheDir, name, args) {
  switch (name) {
    case 'steamdt_get_base_info':         return await handleGetBaseInfo(cfg, cacheDir, args);
    case 'steamdt_search_item_by_name':   return handleSearchByName(cacheDir, args);
    case 'steamdt_get_price_single':      return await handleGetPriceSingle(cfg, args);
    case 'steamdt_get_price_batch':       return await handleGetPriceBatch(cfg, args);
    case 'steamdt_get_price_avg7d':       return await handleGetPriceAvg7d(cfg, args);
    case 'steamdt_get_item_kline':        return await handleGetItemKline(cfg, args);
    case 'steamdt_get_broad_kline':       return await handleGetBroadKline(cfg, args);
    case 'steamdt_get_broad_index':       return await handleGetBroadIndex(cfg);
    case 'steamdt_get_wear_by_inspect_url': return await handleGetWearByUrl(cfg, args);
    case 'steamdt_get_wear_by_asmd':      return await handleGetWearByAsmd(cfg, args);
    case 'steamdt_get_inspect_by_url':    return await handleGetInspectByUrl(cfg, args);
    case 'steamdt_get_inspect_by_asmd':   return await handleGetInspectByAsmd(cfg, args);
    case 'steamdt_special_styles':        return handleSpecialStyles();
    default:                              return { success: false, errorCode: -99, errorMsg: `Unknown tool: ${name}` };
  }
}

module.exports = {
  // Config
  getConfig,
  // .env
  loadEnvFile,
  tryLoadEnv,
  // Styles
  SPECIAL_STYLES,
  // Cache
  loadBaseInfoCache,
  saveBaseInfoCache,
  ensureCacheDir,
  getBaseInfoCachePath,
  // HTTP
  apiRequest,
  // Search
  normalizeText,
  containsAllKeywords,
  searchItems,
  // Tool handlers
  handleGetBaseInfo,
  handleSearchByName,
  handleGetPriceSingle,
  handleGetPriceBatch,
  handleGetPriceAvg7d,
  handleGetItemKline,
  handleGetBroadKline,
  handleGetBroadIndex,
  handleGetWearByUrl,
  handleGetWearByAsmd,
  handleGetInspectByUrl,
  handleGetInspectByAsmd,
  handleSpecialStyles,
  dispatchTool,
};
