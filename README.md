# 🧠 algo-memory

**纯算法长期记忆插件 - 默认启用 LLM / 支持多模型**

[![Version](https://img.shields.io/badge/Version-2.2.0-blue)](https://github.com/xcqblue/algo-memory)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

---

## ✨ 特性

| 分类 | 特性 |
|------|------|
| **LLM** | 默认启用 / 11+ 模型 / 阈值触发 |
| **存储** | 0 API / 本地 SQLite / FTS5 全文搜索 |
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

# 3. 重启 OpenClaw
openclaw gateway restart
```

**零配置自动启用！**

---

## 🤖 支持的 LLM 模型

### 🇨🇳 国内（推荐）

| 模型 | provider | 可选模型 |
|------|----------|----------|
| MiniMax 2.5 | `minimax` | abab6.5s-chat, abab6.5g-chat, abab6.5s-chat-200k |
| 阿里百炼 | `bailian` | qwen-plus, qwen-turbo, qwen-max, qwen-long |
| DeepSeek | `deepseek` | deepseek-chat, deepseek-coder |
| Kimi | `kimi` | kimi-chat, kimi-chat-latest |
| 智谱 AI | `zhipu` | glm-4, glm-4-flash, glm-3-turbo |
| 腾讯混元 | `hunyuan` | hunyuan-pro, hunyuan-standard |
| 百度文心 | `wenxin` | ernie-4.0-8k, ernie-3.5-8k, ernie-speed-8k |
| SiliconFlow | `siliconflow` | Qwen/Qwen2-7B-Instruct, THUDM/glm-4-9b-chat |

### 🌍 国外

| 模型 | provider | 默认模型 |
|------|----------|----------|
| OpenAI | `openai` | gpt-4o-mini |
| Anthropic | `anthropic` | claude-3-haiku |
| Ollama | `ollama` | llama2 |

### 配置示例

```json
{
  "llm": {
    "enabled": true,
    "provider": "auto",    // 自动选择 MiniMax
    "provider": "deepseek", // 手动指定
    "apiKey": "your-key"
  }
}
```

---

## ⚙️ 核心配置

```json
{
  "autoCapture": true,     // 自动存储
  "autoRecall": true,      // 自动召回
  "maxResults": 5,         // 召回数量
  "capturePerTurn": 3,     // 每轮最多存储
  "smartDedup": true,      // 智能去重
  "recencyDecay": true     // 时间衰减
}
```

### 🔒 Agent 隔离配置

```json
{
  "scopes": {
    "enabled": true,           // 启用隔离（默认）
    "visibleAgents": []       // 允许查看的Agent列表
  }
}
```

| visibleAgents | 行为 |
|---------------|------|
| `[]` (空) | 只能看自己的记忆 |
| `["*"]` | 可以看全部Agent的记忆 |
| `["agent-A"]` | 可以看自己和A的记忆 |

详细配置见 [CONFIG.md](./CONFIG.md)

---

## 🔧 工具 (11个)

| 工具 | 功能 |
|------|------|
| `algo_memory_list` | 列出记忆 |
| `algo_memory_search` | 搜索记忆 |
| `algo_memory_stats` | 统计 |
| `algo_memory_get` | 获取单条 |
| `algo_memory_delete` | 删除 |
| `algo_memory_delete_bulk` | 批量删除 |
| `algo_memory_clear` | 清空 |
| `algo_memory_update` | 更新 |
| `algo_memory_export` | 导出 |
| `algo_memory_import` | 导入 |
| `algo_memory_session` | Session记忆 |

---

## 📊 性能

| 操作 | 速度 |
|------|------|
| 写入 | 4,000+ 条/秒 |
| 读取 | 30,000+ 次/秒 |

---

## 📖 文档

| 文档 | 内容 |
|------|------|
| [INSTALL.md](./INSTALL.md) | 安装指南 |
| [CONFIG.md](./CONFIG.md) | 配置详解 |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | 架构设计 |
| [FLOW.md](./FLOW.md) | 流程图 |

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
