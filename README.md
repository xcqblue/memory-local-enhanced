# 🧠 algo-memory

**纯算法长期记忆插件 - 默认启用 LLM / 支持多模型**

[![Version](https://img.shields.io/badge/Version-2.2.0-blue)](https://github.com/xcqblue/algo-memory)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

---

## ✨ 特性

| 分类 | 特性 |
|------|------|
| **LLM** | 默认启用 / 11+ 模型 / 阈值触发 |
| **存储** | 本地 SQLite / FTS5 全文搜索 |
| **智能** | 核心记忆 / 智能去重 / 三层晋升 / 时间衰减 |
| **工具** | 11 个工具 / 完整记忆管理 |
| **隔离** | Agent隔离 / 支持跨Agent查看 |
| **多语言** | 中文/英文/日文/韩文/西班牙文/法文/德文 |

---

## 🚀 快速开始

```bash
# 1. 克隆插件
git clone https://github.com/xcqblue/algo-memory.git ~/.openclaw/extensions/algo-memory

# 2. 安装依赖
cd ~/.openclaw/extensions/algo-memory && npm install
```

**零配置自动启用！**

---

## 🤖 支持的 LLM

| 类型 | 模型 |
|------|------|
| 🇨🇳 国内 | MiniMax / 阿里百炼 / DeepSeek / Kimi / 智谱 / 腾讯混元 / 百度文心 |
| 🌍 国外 | OpenAI / Anthropic / Ollama |

```json
{
  "llm": {
    "enabled": true,
    "provider": "auto",
    "apiKey": "your-key"
  }
}
```

---

## ⚙️ 常用配置

```json
{
  "autoCapture": true,
  "autoRecall": true,
  "maxResults": 5,
  "scopes": {
    "enabled": true,
    "visibleAgents": []
  }
}
```

---

## 📖 文档

| 文档 | 内容 |
|------|------|
| [INSTALL.md](./INSTALL.md) | 安装指南 / 环境要求 / 常见问题 |
| [CONFIG.md](./CONFIG.md) | 完整配置项说明 / LLM模型列表 |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | 架构设计 / 数据结构 |
| [FLOW.md](./FLOW.md) | 详细流程图 |

---

## 📁 数据

- **位置**: `~/.openclaw/workspace/algo-memory/memories.db`
- **格式**: SQLite (WAL 模式)
- **清理**: 180 天自动清理

---

## 🔗 链接

- [GitHub](https://github.com/xcqblue/algo-memory)
- [问题反馈](https://github.com/xcqblue/algo-memory/issues)

MIT License
