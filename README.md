# 🧠 memory-local-enhanced

纯算法长期记忆插件 - 0 API / 可选 LLM 增强

[![OpenClaw Plugin](https://img.shields.io/badge/OpenClaw-Plugin-blue)](https://github.com/openclaw/openclaw)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

## ✨ 特性

- ✅ Agent 独立记忆 (每个 Agent 有自己的记忆空间)
- ✅ 6 类分类 (preference/fact/event/entity/case/pattern)
- ✅ 两层分层 (core 重要记忆 / general 普通记忆)
- ✅ 自动识别核心记忆 (根据关键词: 记住/重要/关键等)
- ✅ **智能去重 (Jaccard 算法)** - 自动合并相似内容
- ✅ **时间衰减** - 近期记忆权重更高 (默认 90 天半衰期)
- ✅ FTS5 全文搜索
- ✅ LRU 缓存加速 (5分钟 TTL)
- ✅ 哈希去重 (SHA256)
- ✅ 噪声过滤 (过滤无效内容)
- ✅ 异步存储 (不阻塞对话)
- ✅ 可选 LLM 增强 (MiniMax/OpenAI/Claude/DeepSeek/Ollama)
- ✅ 删除 Agent 时自动清理记忆和 FTS 索引
- ✅ 定时自动清理过期记忆 (默认 90 天)
- ✅ CLI 命令管理 (15 个命令)
- ✅ GitHub 在线更新
- ✅ 本地文件更新
- ✅ 版本管理 (日期格式 YYYYMMDD)
- ✅ XSS 安全防护
- ✅ 公共记忆 (可选，多 Agent 共享)

---

## 📊 性能

| 指标 | 目标 |
|------|------|
| 读取耗时 | < 50ms |
| 缓存命中 | < 5ms |
| 写入 | 异步不阻塞 |
| 内存占用 | < 30MB |

---

## 🏗️ 架构

```
┌─────────────────────────────────────────────────────────────┐
│                    OpenClaw                                 │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────────┐     ┌─────────────────┐              │
│  │  agent_end      │     │ before_agent_  │              │
│  │  (对话结束)     │     │ start (对话开始) │              │
│  └────────┬────────┘     └────────┬────────┘              │
│           │                      │                         │
│           ▼                      ▼                         │
│  ┌─────────────────────────────────────────┐              │
│  │         memory-local-enhanced            │              │
│  ├─────────────────────────────────────────┤              │
│  │  ┌───────────┐    ┌───────────────┐   │              │
│  │  │  存储流程  │    │   读取流程    │   │              │
│  │  │  (异步)   │    │   (同步)     │   │              │
│  │  └───────────┘    └───────────────┘   │              │
│  │  ┌───────────┐    ┌───────────────┐   │              │
│  │  │  LLM层    │    │   缓存层      │   │              │
│  │  │ (可选)    │    │   (LRU)      │   │              │
│  │  └───────────┘    └───────────────┘   │              │
│  └────────────────┬────────────────────────┘              │
│                   │                                       │
│                   ▼                                       │
│  ┌─────────────────────────────────────────┐              │
│  │           SQLite + FTS5                 │              │
│  │           (本地文件)                     │              │
│  └─────────────────────────────────────────┘              │
└─────────────────────────────────────────────────────────────┘
```

---

## 🔄 核心流程

### 1. 存储流程 (agent_end)

```
用户对话结束
       │
       ▼
┌──────────────────┐
│  噪声过滤        │
│  跳过无效内容    │
│  (问候/确认/命令)│
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│  判断长度        │
│  > threshold?   │
└────────┬─────────┘
         │
    ┌────┴────┐
    │          │
   Yes         No
    │          │
    ▼          ▼
┌────────┐  ┌──────────────────┐
│ LLM    │  │ 规则分类         │
│ 处理   │  │ 6类: preference/│
│        │  │ fact/event/      │
│ •分类  │  │ entity/case/     │
│ •关键词│  │ pattern          │
└───┬────┘  └────────┬─────────┘
    │               │
    └───────┬───────┘
            │
            ▼
┌──────────────────┐
│  关键词提取      │
│  (正则/模型)    │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│  哈希去重       │
│  SHA256 检查     │
└────────┬─────────┘
         │
    ┌────┴────┐
    │ 存在?    │
    │ Yes      │ No
    ▼          ▼
┌────────┐  ┌──────────────────┐
│更新访问│  │ 写入新记忆      │
│时间+1  │  │ + FTS5 索引     │
└────────┘  └────────┬─────────┘
                     │
                     ▼
            ┌──────────────────┐
            │ 清理缓存         │
            └──────────────────┘
```

### 2. 读取流程 (before_agent_start)

```
用户发起对话
       │
       ▼
┌──────────────────┐
│  检查 Agent ID   │
│  (防御性)        │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│  查缓存 (LRU)   │
│  key: agent+query│
└────────┬─────────┘
         │
    ┌────┴────┐
    │ 命中?   │
    │ Yes     │ No
    ▼         ▼
┌────────┐  ┌──────────────────┐
│直接返回│  │ 搜索            │
│        │  │ (core 优先)    │
└────────┘  └────────┬─────────┘
                     │
                     ▼
            ┌──────────────────┐
            │ 排序             │
            │ core > general  │
            │ > importance    │
            │ > access_count │
            └────────┬─────────┘
                     │
                     ▼
            ┌──────────────────┐
            │ 限制 Token       │
            │ < maxContextChars│
            └────────┬─────────┘
                     │
                     ▼
            ┌──────────────────┐
            │ XSS 转义输出    │
            └────────┬─────────┘
                     │
                     ▼
            注入 systemPrompt
```

### 3. 定时清理流程

```
每天自动执行
       │
       ▼
┌──────────────────┐
│ 计算过期时间     │
│ now - cleanupDays│
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ 删除过期 general │
│ 记忆 + FTS 索引 │
│ (保留 core)     │
└────────┬─────────┘
         │
         ▼
日志输出清理数量
```

---

## 🔌 LLM 模型层 (可插拔)

```
┌──────────────────────────────────────┐
│         模型选择 (配置决定)            │
├──────────────────────────────────────┤
│   config.llm.provider =              │
│   ┌─────────┐                        │
│   │ minimax │ → MiniMax API         │
│   ├─────────┤                        │
│   │ openai  │ → OpenAI API          │
│   ├─────────┤                        │
│   │ claude  │ → Anthropic API       │
│   ├─────────┤                        │
│   │ deepseek│ → DeepSeek API        │
│   ├─────────┤                        │
│   │ ollama  │ → 本地模型             │
│   └─────────┘                        │
│                                      │
│   效果 = 模型强度 × 配置             │
└──────────────────────────────────────┘
```

---

## 📊 数据表结构

```sql
-- 记忆表
CREATE TABLE memories (
    id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL,
    content TEXT NOT NULL,
    type TEXT DEFAULT 'other',
    layer TEXT DEFAULT 'general',
    keywords TEXT,
    importance REAL DEFAULT 0.5,
    access_count INTEGER DEFAULT 0,
    created_at INTEGER,
    last_accessed INTEGER,
    content_hash TEXT
);

-- 索引
CREATE INDEX idx_agent ON memories(agent_id);
CREATE INDEX idx_agent_hash ON memories(agent_id, content_hash);
CREATE INDEX idx_layer ON memories(agent_id, layer);

-- FTS5 全文索引
CREATE VIRTUAL TABLE memories_fts USING fts5(
    id UNINDEXED,
    content,
    keywords
);

-- 版本管理
CREATE TABLE memory_metadata (
    key TEXT PRIMARY KEY,
    value TEXT
);
```

---

## ⚙️ 配置

```json
{
  "autoCapture": true,
  "autoRecall": true,
  "maxResults": 5,
  "maxContextChars": 500,
  "cacheEnabled": true,
  "cleanupDays": 90,
  "llm": {
    "enabled": false,
    "provider": "minimax",
    "thresholdLength": 100,
    "apiKey": "",
    "model": "abab6.5s-chat",
    "baseURL": "https://api.minimax.chat/v1"
  }
}
```

### 配置说明

| 配置 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `autoCapture` | boolean | true | 自动捕获对话内容 |
| `autoRecall` | boolean | true | 自动召回记忆 |
| `maxResults` | number | 5 | 最大召回条数 |
| `maxContextChars` | number | 500 | 上下文最大字符数 |
| `cacheEnabled` | boolean | true | 启用 LRU 缓存 |
| `cleanupDays` | number | 90 | 过期清理天数 |
| `llm.enabled` | boolean | false | 启用 LLM 增强 |
| `llm.provider` | string | minimax | LLM 提供商 |
| `llm.thresholdLength` | number | 100 | 触发 LLM 的最小长度 |
| `llm.apiKey` | string | - | API 密钥 |
| `llm.model` | string | - | 模型名称 |
| `llm.baseURL` | string | - | API 地址 |

---

## 🔧 CLI 命令

```bash
# 列出记忆
memory list -a <agent-id> [-l 20]

# 搜索记忆
memory search -a <agent-id> -q <关键词>

# 查看统计
memory stats [-a <agent-id>]

# 删除 Agent 及记忆
memory delete-agent -a <agent-id>

# 清理过期记忆
memory cleanup

# 检查更新
memory check-update

# 从 GitHub 更新
memory update

# 从本地文件更新
memory update-file -p <path>

# 增加版本后缀 (当天多次更新时)
memory bump-version
```

---

## 📝 API

```typescript
import { MemoryPlugin } from './src/index';

const memory = new MemoryPlugin({
  autoCapture: true,
  autoRecall: true,
  maxResults: 5,
  maxContextChars: 500,
  cleanupDays: 90,
  llm: {
    enabled: false,
    provider: 'minimax',
    apiKey: 'your-api-key',
    model: 'abab6.5s-chat',
    baseURL: 'https://api.minimax.chat/v1'
  }
});

await memory.init();

// 存储记忆
await memory.store(agentId, messages);

// 召回记忆
const result = await memory.recall(agentId, query);

// 手动设置核心记忆
await memory.setCoreMemory(agentId, content, 'fact');

// 手动升级为核心
await memory.promoteToCore(agentId, memoryId);

// 标记为核心记忆
await memory.markAsCore(memoryId);

// 删除 Agent 及记忆
await memory.deleteAgent(agentId);

// 清理过期记忆
await memory.cleanupExpired();

// 获取统计
memory.getStats(agentId);

// 列出记忆
memory.listMemories(agentId, limit, offset);

// 搜索记忆
memory.searchMemories(agentId, query, limit);

// 检查更新
await memory.checkUpdate();

// 从 GitHub 更新
await memory.updateFromGitHub();

// 从文件更新
await memory.updateFromFile('/path/to/index.ts');

// 关闭
memory.close();
```

---

## 🏷️ 核心记忆 (Core) 自动识别

记忆分为两层：`core` (核心) 和 `general` (普通)

### 自动识别规则

系统会根据内容关键词自动判断是否为核心记忆：

| 关键词 | 说明 |
|--------|------|
| 记住、牢记 | 用户要求记住 |
| 重要、关键 | 用户强调重要性 |
| 不要忘记、别忘了 | 用户提醒不要忘 |
| 永久保留、一直记住 | 用户希望长期保存 |
| remember、important、never forget | 英文关键词 |

### 识别示例

```
"请记住我的名字是张三" → core (包含"记住")
"这是我最重要的信息" → core (包含"重要")
"一直记住这个习惯" → core (包含"记住")
"我喜欢蓝色" → general (普通偏好)
```

### 手动设置

也可以手动设置核心记忆：

```typescript
// 直接创建核心记忆
await memory.setCoreMemory(agentId, content, 'fact');

// 标记现有记忆为核心
await memory.markAsCore(memoryId);

// 手动升级
await memory.promoteToCore(agentId, memoryId);
```

### 清理策略

- **core**: 永久保留，不会被清理
- **general**: 90 天后自动清理 (可配置)

---

## 🏷️ 版本管理

- 版本号格式: `YYYYMMDD` (如 `20260313`)
- 当天多次更新: `20260313a`, `20260313b`...
- 版本号文件: `VERSION.txt`

---

## 📁 文件结构

```
memory-local-enhanced/
├── src/
│   └── index.ts          # 主源码
├── VERSION.txt           # 版本号
├── package.json
├── tsconfig.json
└── README.md
```

---

## 📄 License

MIT License
