# algo-memory 安装指南

## 环境要求

| 项目 | 要求 |
|------|------|
| OpenClaw | 2.0.0+ |
| Node.js | 18+ |
| 操作系统 | Linux / macOS / Windows (WSL) |

## ⚠️ 重要：必须按顺序执行

### 步骤 1: 克隆仓库

```bash
cd ~/.openclaw/plugins
git clone https://github.com/xcqblue/algo-memory.git
cd algo-memory
```

### 步骤 2: 安装依赖 (关键!)

```bash
npm install
```

**⚠️ 这一步必须执行，否则：**
- 会报错 "node_modules not found"
- 会报错 "better-sqlite3 bindings not found"

### 步骤 3: 重新编译原生模块 (关键!)

```bash
npm rebuild better-sqlite3
```

**⚠️ 这一步必须执行，否则：**
- 会报错 "Cannot find module 'better-sqlite3'"
- 会报错 "native bindings not found"

### 步骤 4: 配置 OpenClaw

编辑 `~/.openclaw/openclaw.json`:

```json
{
  "plugins": {
    "allow": ["algo-memory"],
    "slots": {
      "memory": "algo-memory"
    },
    "entries": {
      "algo-memory": {
        "enabled": true,
        "config": {
          "autoCapture": true,
          "autoRecall": true,
          "maxResults": 5,
          "cleanupDays": 180,
          "recencyDecay": true
        }
      }
    }
  }
}
```

### 步骤 5: 重启 Gateway

```bash
openclaw gateway restart
```

---

## 完整安装命令

```bash
# 1. 克隆
cd ~/.openclaw/plugins
git clone https://github.com/xcqblue/algo-memory.git
cd algo-memory

# 2. 安装依赖 (必须!)
npm install

# 3. 重新编译 (必须!)
npm rebuild better-sqlite3

# 4. 配置
# 编辑 ~/.openclaw/openclaw.json 添加配置

# 5. 重启
openclaw gateway restart
```

---

## 故障排查

### 错误1: node_modules not found

```bash
npm install
```

### 错误2: better-sqlite3 bindings not found

```bash
npm rebuild better-sqlite3
```

### 错误3: 插件崩溃

确保使用最新版本:
```bash
git pull origin main
npm install
npm rebuild better-sqlite3
openclaw gateway restart
```

---

## 常见问题

### Q: 需要 Node.js 吗？
A: 是的，需要 Node.js 18+

### Q: 需要 API Key 吗？
A: 不需要，完全本地运行

### Q: 与 Memos 冲突吗？
A: 是的，slots.memory 只能选一个
