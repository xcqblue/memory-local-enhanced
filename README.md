# 🧠 memory-local-enhanced

纯算法长期记忆插件 - 0 API / 可选 LLM 增强

[![OpenClaw Plugin](https://img.shields.io/badge/OpenClaw-Plugin-blue)](https://github.com/openclaw/openclaw)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

## ✨ 特性

- ✅ Agent 独立记忆 (每个 Agent 有自己的记忆空间)
- ✅ 6 类分类 (preference/fact/event/entity/case/pattern)
- ✅ 两层分层 (core/general)
- ✅ FTS5 全文搜索
- ✅ LRU 缓存加速
- ✅ 哈希去重 (防止重复存储)
- ✅ 噪声过滤 (过滤无效内容)
- ✅ 异步存储 (不阻塞对话)
- ✅ 可选 LLM 增强 (MiniMax/OpenAI/Claude/Ollama)
- ✅ 删除 Agent 时自动清理记忆
- ✅ 轻量高效 (< 50ms)

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
│ 处理   │  │ 6类: preference/ │
│        │  │ fact/event/      │
│ •分类  │  │ entity/case/     │
│ •关键词│  │ pattern          │
│ •压缩  │  └────────┬─────────┘
└───┬────┘          │
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
│  检查重复       │
└────────┬─────────┘
         │
    ┌────┴────┐
    │ 存在?   │
    │ Yes     │ No
    ▼         ▼
┌────────┐  ┌──────────────────┐
│更新访问│  │ 写入新记忆      │
│时间   │  │ • agent_id      │
└────────┘  │ • content       │
            │ • type          │
            │ • keywords      │
            │ • importance    │
            └────────┬─────────┘
                     │
                     ▼
            ┌──────────────────┐
            │ 清理缓存         │
            │ (相关 key)      │
            └──────────────────┘
```

### 2. 读取流程 (before_agent_start)

```
用户发起对话
       │
       ▼
┌──────────────────┐
│  检查 Agent ID   │
│  (防御性)       │
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
│直接返回│  │ FTS5 搜索       │
│        │  │ • agent_id 过滤 │
└────────┘  │ • 关键词匹配    │
            └────────┬─────────┘
                     │
                     ▼
            ┌──────────────────┐
            │  排序            │
            │  分数 =          │
            │  importance *0.5 │
            │  + access*0.3   │
            │  + recency*0.2  │
            └────────┬─────────┘
                     │
                     ▼
            ┌──────────────────┐
            │  限制数量        │
            │  Top N          │
            └────────┬─────────┘
                     │
                     ▼
            ┌──────────────────┐
            │  限制 Token      │
            │  < maxChars     │
            └────────┬─────────┘
                     │
                     ▼
            ┌──────────────────┐
            │  格式化输出     │
            │  Markdown 格式  │
            └────────┬─────────┘
                     │
                     ▼
            ┌──────────────────┐
            │  缓存结果       │
            └────────┬─────────┘
                     │
                     ▼
            返回记忆上下文
```

### 3. 删除 Agent 流程

```
删除 Agent 信号
       │
       ▼
┌──────────────────┐
│  删除记忆        │
│  WHERE agent_id  │
│  = ?            │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│  删除 FTS 索引  │
│  (关联记录)      │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│  清理缓存       │
│  pattern: *:   │
│  {agentId}:*   │
└──────────────────┘
```

---

## 🔌 LLM 模型层 (可插拔)

```
┌──────────────────────────────────────┐
│         模型选择 (配置决定)            │
├──────────────────────────────────────┤
│   config.llm.provider =              │
│   ┌─────────┐                        │
│   │ minimax │ → MiniMax API          │
│   ├─────────┤                        │
│   │ openai  │ → OpenAI API           │
│   ├─────────┤                        │
│   │ claude  │ → Anthropic API        │
│   ├─────────┤                        │
│   │ deepseek│ → DeepSeek API         │
│   ├─────────┤                        │
│   │ ollama  │ → 本地模型              │
│   └─────────┘                        │
│                                      │
│   效果 = 模型强度 × 配置              │
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
CREATE VIRTUAL TABLE memories_fts USING fts5(content, keywords);
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

| 配置 | 默认值 | 说明 |
|------|--------|------|
| autoCapture | true | 自动捕获对话中的记忆 |
| autoRecall | true | 自动召回相关记忆 |
| maxResults | 5 | 最大召回数量 |
| maxContextChars | 500 | 上下文最大字符数 |
| cacheEnabled | true | 启用缓存 |
| cleanupDays | 90 | 清理天数 |

### LLM 配置

| 配置 | 说明 |
|------|------|
| enabled | 是否启用 LLM 增强 |
| provider | 模型提供商: minimax/openai/claude/deepseek/ollama |
| thresholdLength | 超过此长度才调用 LLM |
| apiKey | API 密钥 |
| model | 模型名称 |
| baseURL | API 地址 |

---

## 🚀 安装

```bash
# 方式 1: npm
npm install memory-local-enhanced

# 方式 2: 复制到 plugins 目录
cp -r memory-local-enhanced ~/.openclaw/plugins/
```

### OpenClaw 配置

在 `openclaw.json` 中添加:

```json
{
  "plugins": {
    "slots": {
      "memory": "memory-local-enhanced"
    },
    "entries": {
      "memory-local-enhanced": {
        "enabled": true,
        "config": {
          "autoCapture": true,
          "autoRecall": true,
          "maxResults": 5,
          "maxContextChars": 500
        }
      }
    }
  }
}
```

### 重启 OpenClaw

```bash
openclaw gateway restart
```

---

## 🔧 CLI 命令

```bash
# 查看记忆列表
memory list

# 搜索记忆
memory search "query"

# 查看统计
memory stats

# 删除 Agent 及记忆
memory delete-agent <agent-id>
```

---

## ✅ 逻辑冲突检查

| 问题 | 解决方案 |
|------|----------|
| 缓存不一致 | 写入后 pattern 清理缓存 |
| FTS 索引不同步 | 删除时同时删除 FTS 记录 |
| 哈希不准确 | 内容标准化后再哈希 |
| 并发安全 | SQLite 事务 + 参数化 |
| Agent 过滤 | 参数化 + 二次校验 |
| LLM 失败 | 默认规则值保底 |
| Token 限制 | 准确估算后截断 |
| 冷启动 | 空记忆时返回空结果 |

---

## 📝 核心原则

```
所有操作:
├── 参数化查询 (防注入)
├── 事务包装 (防并发)
├── 缓存清理 (防过期)
├── 二次校验 (防越权)
└── 降级处理 (防崩溃)
```

---

## License

MIT
