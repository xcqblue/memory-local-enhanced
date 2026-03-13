# algo-memory 安装指南

## 环境要求

- OpenClaw 2.0.0+
- Node.js 18+
- (可选) LLM API Key (如需增强)

---

## 安装方式

### 方式一：克隆到 workspace（推荐）

```bash
# 1. 克隆插件
cd ~/.openclaw/workspace
git clone https://github.com/xcqblue/algo-memory.git plugins/algo-memory
cd plugins/algo-memory

# 2. 安装依赖
npm install
```

### 方式二：绝对路径加载

```bash
# 克隆到任意位置
git clone https://github.com/xcqblue/algo-memory.git /path/to/algo-memory
cd /path/to/algo-memory
npm install
```

---

## 配置 OpenClaw

编辑 `~/.openclaw/openclaw.json`:

### 方式一：workspace 模式

```json
{
  "plugins": {
    "load": {
      "paths": ["plugins/algo-memory"]
    },
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
          "noiseFilter": {
            "enabled": true
          },
          "adaptiveRetrieval": {
            "enabled": true
          },
          "sessionMemory": {
            "enabled": false
          },
          "weibullDecay": {
            "enabled": false
          },
          "mmr": {
            "enabled": false
          },
          "scopes": {
            "enabled": false
          }
        }
      }
    }
  }
}
```

### 方式二：绝对路径模式

```json
{
  "plugins": {
    "load": {
      "paths": ["/absolute/path/to/algo-memory"]
    },
    "slots": {
      "memory": "algo-memory"
    },
    "entries": {
      "algo-memory": {
        "enabled": true,
        "config": {
          "autoCapture": true,
          "autoRecall": true
        }
      }
    }
  }
}
```

### LLM 增强配置（可选）

```json
{
  "plugins": {
    "slots": {
      "memory": "algo-memory"
    },
    "entries": {
      "algo-memory": {
        "enabled": true,
        "config": {
          "autoCapture": true,
          "autoRecall": true,
          "llm": {
            "enabled": true,
            "provider": "openai",
            "apiKey": "${OPENAI_API_KEY}",
            "model": "gpt-4o-mini",
            "baseURL": "https://api.openai.com/v1"
          },
          "threshold": {
            "useLlmForCore": true,
            "useLlmForExtract": false,
            "useLlmForDedup": false
          }
        }
      }
    }
  }
}
```

---

## 重启并验证

```bash
# 1. 验证配置
openclaw config validate

# 2. 重启 Gateway
openclaw gateway restart

# 3. 查看插件信息
openclaw plugins info algo-memory

# 4. 查看钩子列表
openclaw hooks list --json

# 5. 查看日志
openclaw logs --follow --plain | grep algo-memory
```

预期输出：
```
[algo-memory] 插件注册完成, 工具数: 10
[algo-memory] 数据库初始化: /home/x/.openclaw/workspace/algo-memory/memories.db
```

---

## 验证清单

- [ ] `openclaw config validate` 通过
- [ ] `openclaw gateway restart` 成功
- [ ] 插件加载无报错
- [ ] 工具注册成功 (10个)
- [ ] 钩子注册成功

---

## 常见问题

### Q: 插件没有加载？
A: 检查 `openclaw.json` 配置是否正确，确保 `plugins.load.paths` 包含插件路径。

### Q: 工具无法使用？
A: 确保 `plugins.slots.memory` 绑定到正确的插件 ID。

### Q: 报错 better-sqlite3？
A: 需要重新编译: `npm rebuild better-sqlite3`

---

## 完整配置参考

```json
{
  "autoCapture": true,
  "autoRecall": true,
  "maxResults": 5,
  "cleanupDays": 180,
  "recencyDecay": true,
  "recencyHalfLife": 180,
  "smartDedup": true,
  "dedupThreshold": 0.85,
  "coreKeywords": ["记住", "重要", "不要忘记"],
  "noiseFilter": {
    "enabled": true,
    "skipGreetings": true,
    "skipCommands": true
  },
  "adaptiveRetrieval": {
    "enabled": true,
    "minQueryLength": 2
  },
  "sessionMemory": {
    "enabled": false,
    "maxSessionItems": 10
  },
  "weibullDecay": {
    "enabled": false,
    "shape": 1.5,
    "scale": 90
  },
  "scopes": {
    "enabled": false,
    "defaultScope": "agent"
  },
  "mmr": {
    "enabled": false,
    "threshold": 0.85
  },
  "llm": {
    "enabled": false,
    "provider": "openai",
    "apiKey": "",
    "model": "gpt-4o-mini",
    "baseURL": "https://api.openai.com/v1"
  },
  "threshold": {
    "useLlmForCore": false,
    "useLlmForExtract": false,
    "useLlmForDedup": false,
    "minConfidence": 0.8
  }
}
```

---

## 更多信息

- GitHub: https://github.com/xcqblue/algo-memory
- 问题反馈: https://github.com/xcqblue/algo-memory/issues
