# 🧠 algo-memory

**纯算法长期记忆插件 - 0 API，完全本地运行，无需网络**

[![OpenClaw Plugin](https://img.shields.io/badge/OpenClaw-Plugin-blue)](https://github.com/openclaw/openclaw)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

## ✨ 特性

- ✅ **纯算法** - 哈希查重、Jaccard智能去重、关键词提取
- ✅ **0 API** - 完全本地 SQLite，无需网络
- ✅ **自动存储/召回** - 对话自动记忆
- ✅ **核心记忆** - 关键词识别，永久保留
- ✅ **时间衰减** - 智能排序
- ✅ **7个工具** - list/search/stats/get/delete/clear/update

---

## 📦 安装

```bash
# 1. 克隆
cd ~/.openclaw/plugins
git clone https://github.com/xcqblue/algo-memory.git

# 2. 安装依赖
cd algo-memory
npm install

# 3. 配置
# 编辑 ~/.openclaw/openclaw.json

# 4. 重启
openclaw gateway restart
```

---

## ⚙️ 配置

```json
{
  "plugins": {
    "allow": ["algo-memory"],
    "slots": { "memory": "algo-memory" },
    "entries": {
      "algo-memory": {
        "enabled": true,
        "config": {
          "autoCapture": true,
          "autoRecall": true,
          "maxResults": 5,
          "cleanupDays": 180,
          "smartDedup": true,
          "recencyDecay": true
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

## 📝 流程

### 存储流程
```
用户输入 → 钩子触发 → 噪声过滤 → XSS转义 → 哈希查重 → Jaccard去重 → 核心判断 → 关键词提取 → 写入数据库
```

### 召回流程
```
用户输入 → 钩子触发 → 缓存检查 → SQL查询 → 时间衰减 → 排序 → 返回结果
```

---

## 📄 License

MIT
