# 🧠 algo-memory

**纯算法长期记忆插件 - 0 API / 可选 LLM 增强**

[![OpenClaw Plugin](https://img.shields.io/badge/OpenClaw-Plugin-blue)](https://github.com/openclaw/openclaw)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

## ✨ 特性

- ✅ **纯算法** - 0 API，完全本地
- ✅ **智能去重** - Jaccard + 可选 LLM
- ✅ **核心记忆** - 关键词识别
- ✅ **时间衰减** - 指数 + Weibull 可选
- ✅ **噪声过滤** - 过滤低质量内容
- ✅ **自适应检索** - 智能触发
- ✅ **多 Scope 隔离** - agent/user/global
- ✅ **7个工具** - list/search/stats/get/delete/clear/update

---

## 📦 安装

```bash
cd ~/.openclaw/plugins
git clone https://github.com/xcqblue/algo-memory.git
cd algo-memory
npm install
```

---

## ⚙️ 配置

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
          "noiseFilter": { "enabled": true },
          "adaptiveRetrieval": { "enabled": true },
          "sessionMemory": { "enabled": false },
          "weibullDecay": { "enabled": false },
          "scopes": { "enabled": false },
          "llm": { "enabled": false },
          "threshold": { "useLlmForCore": false }
        }
      }
    }
  }
}
```

---

## 🔧 工具 (7个)

| 工具 | 说明 |
|------|------|
| memory_list | 列出记忆 |
| memory_search | 搜索记忆 |
| memory_stats | 统计记忆 |
| memory_get | 获取单条 |
| memory_delete | 删除记忆 |
| memory_clear | 清空记忆 |
| memory_update | 更新记忆 |

---

## 📄 License

MIT
