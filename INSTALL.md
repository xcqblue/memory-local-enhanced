# 安装指南

## 环境要求

- OpenClaw 2.0.0+
- Node.js 18+

## 安装步骤

### 1. 克隆仓库

```bash
cd ~/.openclaw/plugins
git clone https://github.com/xcqblue/algo-memory.git
cd algo-memory
```

### 2. 安装依赖

```bash
npm install
```

### 3. 配置 OpenClaw

编辑 `~/.openclaw/openclaw.json`:

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

### 4. 重启 Gateway

```bash
openclaw gateway restart
```

---

## 验证

```bash
openclaw logs | grep algo-memory
```

预期输出:
```
[algo-memory] 插件注册完成, 工具数: 7
[algo-memory] 数据库初始化完成
```
