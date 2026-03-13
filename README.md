# 🧠 algo-memory

纯算法长期记忆插件 - 0 API / 可选 LLM 增强

[![OpenClaw Plugin](https://img.shields.io/badge/OpenClaw-Plugin-blue)](https://github.com/openclaw/openclaw)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

## ✨ 特性

- ✅ Agent 独立记忆 (每个 Agent 有自己的记忆空间)
- ✅ 6 类分类 (preference/fact/event/entity/case/pattern)
- ✅ 两层分层 (core 重要记忆 / general 普通记忆)
- ✅ 自动识别核心记忆 (根据关键词)
- ✅ **智能去重 (Jaccard 算法)** - 自动合并相似内容
- ✅ **时间衰减** - 近期记忆权重更高 (默认 90 天半衰期)
- ✅ FTS5 全文搜索
- ✅ LRU 缓存加速 (5分钟 TTL)
- ✅ 哈希去重 (SHA256)
- ✅ 噪声过滤 (过滤无效内容)
- ✅ 异步存储 (不阻塞对话)
- ✅ 可选 LLM 增强 (MiniMax/OpenAI/Claude/DeepSeek/Ollama)
- ✅ 定时自动清理过期记忆 (默认 90 天)
- ✅ CLI 命令管理
- ✅ GitHub / 文件更新
- ✅ 版本管理 (日期格式 YYYYMMDD)
- ✅ XSS 安全防护
- ✅ 公共记忆 (可选，多 Agent 共享)

## 🚀 快速开始

### 1. 安装依赖

```bash
cd ~/.openclaw
npm install better-sqlite3 lru-cache
```

### 2. 复制插件

```bash
# 方式一：从 GitHub 克隆
cd ~/.openclaw/plugins
git clone https://github.com/xcqblue/algo-memory.git

# 方式二：手动下载复制
```

### 3. 配置

编辑 `~/.openclaw/openclaw.json`:

```json
{
  "plugins": {
    "allow": ["algo-memory"],
    "entries": {
      "algo-memory": {
        "enabled": true,
        "config": {
          "autoCapture": true,
          "autoRecall": true,
          "recencyDecay": true,
          "recencyHalfLife": 90,
          "smartDedup": true,
          "cleanupDays": 90
        }
      }
    }
  }
}
```

### 4. 重启 OpenClaw

重启服务使插件生效。

### 5. 使用 CLI

```bash
# 列出记忆
memory list -a <agent-id>

# 搜索记忆
memory search -a <agent-id> -q <关键词>

# 查看统计
memory stats

# 清理过期
memory cleanup
```

## 📖 文档

- [安装指南](INSTALL.md) - 详细安装步骤
- [架构设计](ARCHITECTURE.md) - 核心流程、LLM模型、数据表结构
- [配置与API](CONFIG.md) - 完整配置、CLI命令、API参考

## 📋 默认配置

| 功能 | 默认值 |
|------|---------|
| 自动存储 | 开 |
| 自动召回 | 开 |
| 智能去重 | **开** |
| 时间衰减 | **开 (90天)** |
| 清理天数 | 180天 |

## 📁 文件结构

```
algo-memory/
├── src/index.ts          # 主源码
├── ARCHITECTURE.md       # 架构设计
├── CONFIG.md            # 配置与API
├── openclaw.plugin.json # 插件配置
├── VERSION.txt          # 版本号
├── README.md            # 本文件
└── memory/              # 项目记录
```

## 🔗 相关链接

- GitHub: https://github.com/xcqblue/algo-memory
- OpenClaw: https://github.com/openclaw/openclaw

## 📄 License

MIT License
