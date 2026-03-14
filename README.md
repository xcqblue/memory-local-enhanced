# 🧠 algo-memory

**纯算法长期记忆插件 - 0 API / 可选 LLM 增强**

[![OpenClaw Plugin](https://img.shields.io/badge/OpenClaw-Plugin-blue)](https://github.com/openclaw/openclaw)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Version](https://img.shields.io/badge/Version-1.9.0-blue)](https://github.com/xcqblue/algo-memory)

## ✨ 特性

- ✅ **0 API 依赖** - 完全本地运行，无需外部服务
- ✅ **可选 LLM 增强** - 支持 OpenAI/Ollama 等
- ✅ **高性能** - 写入 4000+ 条/秒，读取 30000+ 次/秒
- ✅ **FTS5 全文搜索** - SQLite 内置全文搜索引擎，搜索更精准
- ✅ **智能去重** - Jaccard 相似度 + 可选 LLM 判断
- ✅ **核心记忆** - 关键词识别重要信息
- ✅ **三层晋升** - peripheral → working → core
- ✅ **时间衰减** - 指数 + Weibull 可选
- ✅ **噪声过滤** - 过滤低质量内容
- ✅ **自适应检索** - 智能触发召回
- ✅ **多 Scope 隔离** - agent/user/global
- ✅ **错误恢复** - 数据库连接自动重连
- ✅ **11 个工具** - 完整的记忆管理
- ✅ **多语言支持** - 中文/英文/日文/韩文/西班牙文/法文/德文

---

## 📦 安装

### 方式一：克隆到 extensions 目录（推荐）

```bash
# 1. 克隆插件
mkdir -p ~/.openclaw/extensions
git clone https://github.com/xcqblue/algo-memory.git ~/.openclaw/extensions/algo-memory

# 2. 安装依赖
cd ~/.openclaw/extensions/algo-memory
npm install
```

### 方式二：克隆到 plugins 目录

```bash
cd ~/.openclaw/plugins
git clone https://github.com/xcqblue/algo-memory.git
cd algo-memory
npm install
```

---

## ⚙️ 配置

### 最简配置（零配置自动启用）

```json
{
  "plugins": {
    "entries": {
      "algo-memory": {
        "enabled": true
      }
    }
  }
}
```

### 完整配置

```json
{
  "plugins": {
    "slots": { "memory": "algo-memory" },
    "entries": {
      "algo-memory": {
        "enabled": true,
        "config": {
          "autoCapture": true,
          "autoRecall": true,
          "maxResults": 5,
          "capturePerTurn": 3,
          "cleanupDays": 180,
          "language": "auto",
          "recencyDecay": true,
          "recencyHalfLife": 180,
          "smartDedup": true,
          "dedupThreshold": 0.85,
          "coreKeywords": ["记住", "重要", "不要忘记", "remember", "important"],
          "noiseFilter": {
            "enabled": true,
            "skipGreetings": true,
            "skipCommands": true
          },
          "adaptiveRetrieval": {
            "enabled": true,
            "minQueryLength": 2,
            "forceKeywords": ["之前", "上次", "记得", "remember", "before"]
          },
          "sessionMemory": {
            "enabled": true,
            "maxSessionItems": 10
          },
          "tier": {
            "enabled": true,
            "coreThreshold": 3,
            "peripheralThreshold": 0.3,
            "ageDays": 90
          },
          "weibullDecay": {
            "enabled": false,
            "shape": 1.5,
            "scale": 90
          },
          "reinforcement": {
            "enabled": true,
            "factor": 0.1,
            "maxMultiplier": 2.0
          },
          "mmr": {
            "enabled": false,
            "threshold": 0.85
          },
          "scopes": {
            "enabled": false,
            "defaultScope": "agent"
          },
          "llm": {
            "enabled": false,
            "provider": "openai",
            "apiKey": "${OPENAI_API_KEY}",
            "model": "gpt-4o-mini",
            "baseURL": "https://api.openai.com/v1"
          },
          "threshold": {
            "useLlmForCore": false,
            "useLlmForExtract": false,
            "useLlmForDedup": false,
            "lengthForCore": 100,
            "lengthForExtract": 200,
            "dedupUncertaintyMin": 0.5,
            "dedupUncertaintyMax": 0.98
          }
        }
      }
    }
  }
}
```

---

## 🔧 工具 (11个)

| 工具名 | 说明 | 示例 |
|--------|------|------|
| `algo_memory_list` | 列出所有记忆 | 列出我的记忆 |
| `algo_memory_search` | 搜索记忆 | 搜索关于蓝色的记忆 |
| `algo_memory_stats` | 查看统计 | 查看记忆统计 |
| `algo_memory_get` | 获取单条记忆 | 获取 id=xxx 的记忆 |
| `algo_memory_delete` | 删除单条记忆 | 删除这条记忆 |
| `algo_memory_delete_bulk` | 批量删除 | 删除这3条记忆 |
| `algo_memory_clear` | 清空记忆 | 清空所有记忆 |
| `algo_memory_update` | 更新记忆 | 更新这条记忆内容 |
| `algo_memory_export` | 导出记忆 | 导出我的记忆 |
| `algo_memory_import` | 导入记忆 | 导入这段记忆 |
| `algo_memory_session` | 获取Session记忆 | 查看本次召回的记忆 |

---

## 🌐 多语言支持

algo-memory 支持多语言核心关键词识别：

| 语言 | 代码 | 核心关键词 |
|------|------|-----------|
| 中文 | `zh` | 记住、重要、永久保留 |
| English | `en` | remember, important, never forget |
| 日本語 | `ja` | 覚えて, 重要, 忘れないで |
| 한국어 | `ko` | 기억, 중요, 잊지마 |
| Español | `es` | recordar, importante |
| Français | `fr` | rappeler, important |
| Deutsch | `de` | merken, wichtig |

使用方式：
```json
{
  "language": "auto",  // 自动检测
  "language": "zh",    // 强制中文
  "language": "en"     // 强制英文
}
```

---

## 📊 性能数据

| 操作 | 速度 |
|------|------|
| 写入 | 4,000+ 条/秒 |
| 读取 | 30,000+ 次/秒 |
| 统计 | 100,000 次/秒 |
| FTS5 搜索 | 高精度全文搜索 |

---

## 📁 数据存储

- **位置**: `~/.openclaw/workspace/algo-memory/memories.db`
- **格式**: SQLite (WAL 模式)
- **索引**: 6 个索引 + FTS5 全文索引
- **自动清理**: 180 天后自动清理 peripheral 记忆

---

## 🔄 重启验证

```bash
# 重启 Gateway
openclaw gateway restart

# 查看日志
openclaw logs | grep algo-memory
```

预期输出：
```
[algo-memory] 插件注册完成, 工具数: 11, 自动启用: true
[algo-memory] 数据库初始化: /home/x/.openclaw/workspace/algo-memory/memories.db
[algo-memory] FTS5 全文搜索已启用
```

---

## 📖 文档

- [安装指南](./INSTALL.md)
- [配置详解](./CONFIG.md)
- [架构设计](./ARCHITECTURE.md)
- [流程图](./FLOW.md)

---

## 🤝 贡献

欢迎提交 Issue 和 PR！

---

## 📄 License

MIT License

---

## 🔗 相关链接

- [OpenClaw 官网](https://openclaw.ai)
- [GitHub](https://github.com/xcqblue/algo-memory)
- [问题反馈](https://github.com/xcqblue/algo-memory/issues)
