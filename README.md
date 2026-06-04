# SteamDT MCP Server

SteamDT MCP 是一款面向 CS2 饰品交易分析的 [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) 服务器，对接 [SteamDT](https://steamdt.com) 开放平台 API，让 AI 助手（Claude、Cursor、OpenCode 等）可以直接查询 CS2 饰品的实时价格、K 线走势、大盘指数、磨损度、检视图等数据。

## 功能概览

| 分类 | 工具 | 说明 |
|------|------|------|
| 基础数据 | `steamdt_get_base_info` | 获取全量 CS2 饰品基础信息列表 |
| 搜索 | `steamdt_search_item_by_name` | 中/英文模糊搜索饰品 |
| 价格查询 | `steamdt_get_price_single` | 单品全平台在售/求购价格 |
| | `steamdt_get_price_batch` | 批量查询（最多 100 个） |
| | `steamdt_get_price_avg7d` | N 天均价查询 |
| K线数据 | `steamdt_get_item_kline` | 单品 K 线（支持分平台/特殊款式） |
| | `steamdt_get_broad_kline` | CS2 大盘 K 线 |
| 大盘指数 | `steamdt_get_broad_index` | 大盘最新指数（含涨跌） |
| 磨损度 | `steamdt_get_wear_by_inspect_url` | 通过检视链接查询磨损度/贴纸/浮值 |
| | `steamdt_get_wear_by_asmd` | 通过 ASMD 参数查询磨损度 |
| 检视图 | `steamdt_get_inspect_by_url` | 生成 2D 检视图（检视链接方式） |
| | `steamdt_get_inspect_by_asmd` | 生成 2D 检视图（ASMD 参数方式） |
| 款式对照 | `steamdt_special_styles` | 特殊款式对照表（多普勒/渐变/和服等） |

## 快速开始

### 1. 获取 API Key

前往 [SteamDT 开放平台](https://open.steamdt.com) 注册并获取 API Key。

### 2. 克隆并安装

```bash
git clone https://github.com/zkcaryq/steamdt-mcp.git
cd steamdt-mcp
# 无需 npm install，无外部依赖
```

### 3. 配置 API Key

在项目根目录创建 `.env` 文件：

```env
STEAMDT_API_KEY=你的API_KEY
```

可选配置项：

```env
STEAMDT_API_BASE=https://open.steamdt.com    # API 地址（默认）
STEAMDT_TIMEOUT_MS=20000                      # 请求超时（毫秒）
STEAMDT_MAX_RETRIES=2                         # 最大重试次数
STEAMDT_CACHE_DIR=.cache                      # 缓存目录
```

### 4. 连接到 AI 客户端

根据你使用的客户端，在对应的 MCP 配置中添加：

#### Claude Desktop

编辑 `claude_desktop_config.json`：

```json
{
  "mcpServers": {
    "steamdt": {
      "command": "node",
      "args": ["D:/AI/steamDT/steamdt-mcp/src/server.js"],
      "env": {
        "STEAMDT_API_KEY": "你的API_KEY"
      }
    }
  }
}
```

#### Cursor

编辑 `.cursor/mcp.json`：

```json
{
  "mcpServers": {
    "steamdt": {
      "command": "node",
      "args": ["D:/AI/steamDT/steamdt-mcp/src/server.js"],
      "env": {
        "STEAMDT_API_KEY": "你的API_KEY"
      }
    }
  }
}
```

#### OpenCode

编辑 `opencode.json`：

```json
{
  "mcpServers": {
    "steamdt": {
      "command": "node",
      "args": ["D:/AI/steamDT/steamdt-mcp/src/server.js"],
      "env": {
        "STEAMDT_API_KEY": "你的API_KEY"
      }
    }
  }
}
```

## 环境要求

- **Node.js** >= 18.0.0
- **SteamDT API Key**（[注册获取](https://open.steamdt.com)）

本项目零外部依赖，仅使用 Node.js 内置模块（`https`, `fs`, `path`, `readline`）。

## 工具详细说明

---

### `steamdt_get_base_info`

获取 SteamDT 全量 CS2 饰品基础信息列表，包含中文名、`marketHashName`、各平台 `itemId` 映射。

- **频率限制**: 每天 1 次
- **缓存机制**: 结果自动缓存到 `.cache/base_info.json`，后续调用优先使用缓存

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `forceRefresh` | boolean | 否 | 设为 `true` 强制刷新缓存 |

**返回示例**:
```json
{
  "success": true,
  "data": [
    {
      "name": "AK-47 | 红线 (久经沙场)",
      "marketHashName": "AK-47 | Redline (Field-Tested)",
      "platformList": [
        { "name": "BUFF", "itemId": "33885" },
        { "name": "YOUPIN", "itemId": "425" },
        { "name": "C5", "itemId": "22315" }
      ]
    }
  ]
}
```

---

### `steamdt_search_item_by_name`

根据中文或英文模糊搜索饰品，返回匹配的 `marketHashName`。

> ⚠️ 必须先调用 `steamdt_get_base_info` 建立缓存后才能使用搜索功能。

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `query` | string | 是 | - | 搜索关键词（中英文均可，支持分词） |
| `limit` | integer | 否 | 10 | 返回数量上限 |

**使用示例**:
```
搜索 "ak 火蛇" → AK-47 | Fire Serpent
搜索 "m9 doppler" → ★ M9 Bayonet | Doppler
搜索 "印花 renas" → Sticker | Renas
```

---

### `steamdt_get_price_single`

查询单个饰品在各平台的在售/求购实时价格。

- **频率限制**: 60 次/分钟

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `marketHashName` | string | 是 | Steam 官方饰品名称（从 `base_info` 或搜索获取） |

**返回示例**:
```json
{
  "success": true,
  "data": [
    {
      "platform": "BUFF",
      "sellPrice": 12999.5,
      "sellCount": 32,
      "biddingPrice": 11220,
      "biddingCount": 7,
      "updateTime": 1780543978
    },
    {
      "platform": "YOUPIN",
      "sellPrice": 13489.99,
      "sellCount": 225,
      "biddingPrice": 13010,
      "biddingCount": 54
    }
  ]
}
```

**字段说明**:
| 字段 | 含义 |
|------|------|
| `sellPrice` | 最低在售价（元） |
| `sellCount` | 在售数量 |
| `biddingPrice` | 最高求购价（元） |
| `biddingCount` | 求购数量 |

支持平台: BUFF / YOUPIN / C5 / HALOSKINS / STEAM / WAXPEER / DMARKET / SKINPORT / CSMONEY

---

### `steamdt_get_price_batch`

批量查询饰品价格，一次最多 100 个。

- **频率限制**: 1 次/分钟

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `marketHashNames` | string[] | 是 | 饰品名称数组，最少 1 个，最多 100 个 |

**使用示例**:
```json
{
  "marketHashNames": [
    "AK-47 | Redline (Field-Tested)",
    "AWP | Asiimov (Field-Tested)",
    "M4A4 | The Coalition (Factory New)"
  ]
}
```

---

### `steamdt_get_price_avg7d`

查询饰品近 N 天各平台的均价及全平台均价。

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `marketHashName` | string | 是 | - | Steam 官方饰品名称 |
| `days` | integer | 否 | 7 | 回溯天数，例如 7、30、90 |

**返回示例**:
```json
{
  "success": true,
  "data": {
    "marketHashName": "AK-47 | Redline (Field-Tested)",
    "avgPrice": 118.5,
    "dataList": [
      { "platform": "BUFF", "avgPrice": 115.2 },
      { "platform": "YOUPIN", "avgPrice": 120.8 }
    ]
  }
}
```

---

### `steamdt_get_item_kline`

查询单品 K 线数据（OHLC，不含成交量）。

- **频率限制**: 120 次/分钟

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `marketHashName` | string | 是 | 饰品名称 |
| `type` | integer (1-3) | 是 | K 线类型（1=日线/2=4小时/3=1小时） |
| `platform` | string | 否 | 平台筛选：`BUFF` / `YOUPIN` / `C5` / `STEAM` / `HALOSKINS` / `ALL` |
| `specialStyle` | string | 否 | 特殊款式值（参考 `steamdt_special_styles`） |

**返回示例**:
```json
[
  [1735689600, 110.0, 112.5, 108.0, 111.2],
  [1735776000, 111.2, 115.0, 110.5, 114.8]
]
```

每条 K 线格式: `[时间戳, 开盘价, 最高价, 最低价, 收盘价]`

`specialStyle` 适用于需要区分款式的饰品：
- 多普勒/伽玛多普勒 → `p1` / `p2` / `p3` / `p4` / `ruby` / `emerald` / `sapphire` / `blackpearl`
- 渐变大理石 → `1st` ~ `10th`（冰火档位）
- 绯红和服 → `crimson_kimono_p1` ~ `crimson_kimono_p6`
- 表面淬火 → `t1` / `t2` / `t3` / `t4` / `singleblue`（单面全蓝）

---

### `steamdt_get_broad_kline`

查询 CS2 大盘 K 线数据。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `type` | integer (1-3) | 是 | K 线类型（1=日线/2=4小时/3=1小时） |

---

### `steamdt_get_broad_index`

查询 CS2 大盘最新指数（含涨跌值和历史记录）。

无参数。

**返回示例**:
```json
{
  "success": true,
  "data": {
    "broadMarketIndex": 913.88,
    "diffYesterday": 14.18,
    "diffYesterdayRatio": 1.5761,
    "historyMarketIndexList": [
      [1780455600, 881.72],
      [1780459200, 885.15]
    ]
  }
}
```

| 字段 | 含义 |
|------|------|
| `broadMarketIndex` | 当前大盘指数 |
| `diffYesterday` | 较昨日涨跌值 |
| `diffYesterdayRatio` | 较昨日涨跌百分比 |
| `historyMarketIndexList` | 近期历史指数 `[时间戳, 指数值]` |

---

### `steamdt_get_wear_by_inspect_url`

通过 Steam 检视链接查询饰品磨损度及相关数据（磨损值、贴纸、挂件等）。

- **频率限制**: 36000 次/小时

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `inspectUrl` | string | 是 | Steam CS2 检视链接，格式 `steam://rungame/730/...` |
| `notifyUrl` | string | 否 | 异步回调地址，不填则等待同步返回 |

---

### `steamdt_get_wear_by_asmd`

通过 ASMD 参数查询磨损度（替代检视链接方式，适用于已知 ASMD 参数的场景）。

- **频率限制**: 36000 次/小时

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `s` | integer | 否 | ASMD 参数 S |
| `m` | integer | 否 | ASMD 参数 M |
| `a` | integer | 否 | ASMD 参数 A |
| `d` | string | 否 | ASMD 参数 D |
| `notifyUrl` | string | 否 | 异步回调地址 |

---

### `steamdt_get_inspect_by_url`

通过检视链接生成饰品 2D 检视图（需先通过磨损度接口获取数据）。

- **频率限制**: 100 次/天 ⚠️ 稀缺资源

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `inspectUrl` | string | 是 | Steam CS2 检视链接 |
| `notifyUrl` | string | 否 | 异步回调地址 |

---

### `steamdt_get_inspect_by_asmd`

通过 ASMD 参数生成饰品 2D 检视图。

- **频率限制**: 100 次/天 ⚠️ 稀缺资源

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `s` | integer | 否 | ASMD 参数 S |
| `m` | integer | 否 | ASMD 参数 M |
| `a` | integer | 否 | ASMD 参数 A |
| `d` | string | 否 | ASMD 参数 D |
| `notifyUrl` | string | 否 | 异步回调地址 |

---

### `steamdt_special_styles`

获取 CS2 饰品特殊款式对照表，用于解读磨损数据中的 `paintseed` 和特殊款式字段。

无参数。

**返回对照表**:
| 类别 | 可选值 | 说明 |
|------|--------|------|
| `RANK` | `1st` ~ `10th` | 渐变大理石等饰品的档位 |
| `TIER` | `t1` ~ `t4` | 表面淬火等级 |
| `PHASE` | `p1`/`p2`/`p3`/`p4`/`ruby`/`emerald`/`sapphire`/`blackpearl` | 多普勒/伽玛多普勒相位 |
| `SINGLEBLUE` | `singleblue` | 表面淬火单面全蓝 |
| `CRIMSON_KIMONO` | `crimson_kimono_p1` ~ `p6` | 绯红和服档位 |

---

## 典型使用场景

### 场景一: 快速查询饰品价格

向 AI 助手提问：

> "帮我看一下 AK-47 | 红线 (久经沙场) 在各平台的价格"

AI 会自动调用 `steamdt_get_price_single`，返回 BUFF、YOUPIN、C5 等平台的在售价和求购价。

### 场景二: 分析 K 线走势

> "分析 M4A4 | 合纵 (崭新出厂) 最近 BUFF 的 K 线走势"

AI 会调用 `steamdt_get_item_kline`（type=1 日线），结合 `steamdt_get_price_avg7d` 综合判断趋势。

### 场景三: 多普勒刀款式分析

> "这把 ★ Butterfly Knife | Doppler 是什么相位？"

AI 会先用 `steamdt_get_wear_by_inspect_url` 查询磨损数据，再用 `steamdt_special_styles` 对照表解读出具体相位。

### 场景四: 大盘环境判断

> "现在 CS2 市场整体怎么样？"

AI 会调用 `steamdt_get_broad_index` 和 `steamdt_get_broad_kline`，给出大盘趋势判断。

### 场景五: 批量对比

> "帮我对比这 10 把 AK 的 BUFF 在售价"

AI 会调用 `steamdt_get_price_batch` 一次性拉取 10 个饰品的全平台价格。

---

## 频率限制汇总

| 工具 | 限制 |
|------|------|
| `steamdt_get_base_info` | 1 次/天 |
| `steamdt_get_price_single` | 60 次/分钟 |
| `steamdt_get_price_batch` | 1 次/分钟 |
| `steamdt_get_item_kline` | 120 次/分钟 |
| `steamdt_get_wear_by_inspect_url` / `by_asmd` | 36000 次/小时 |
| `steamdt_get_inspect_by_url` / `by_asmd` | 100 次/天 |
| `steamdt_get_price_avg7d` | 无明确限制 |
| `steamdt_get_broad_index` / `kline` | 无明确限制 |
| `steamdt_search_item_by_name` | 本地搜索，无限制 |

---

## 项目结构

```
steamdt-mcp/
├── src/
│   ├── server.js    # MCP 协议服务端（JSON-RPC over stdio）
│   └── lib.js       # 核心函数库（API 请求、缓存、搜索、工具分发）
├── test/
│   ├── whitebox.test.js  # 单元测试（函数级别）
│   └── blackbox.test.js  # 集成测试（启动 MCP 服务端测试）
├── .cache/           # 缓存目录（自动生成，已 gitignore）
├── .env              # API Key 配置（已 gitignore）
├── package.json
└── .gitignore
```

## 运行测试

```bash
# 单元测试
npm run test:whitebox

# 集成测试（需连接 MCP 服务）
npm run test:blackbox

# 全部测试
npm test
```

> 集成测试中，如果设置了真实的 `STEAMDT_API_KEY` 环境变量，还会自动执行 Live API 测试。

## License

MIT
