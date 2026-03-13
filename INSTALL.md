# memory-local-enhanced 安装指南

---

## 环境要求

- Node.js 18+
- OpenClaw
- npm 或 yarn

---

## 安装步骤

### 1. 安装依赖

```bash
cd ~/.openclaw
npm install better-sqlite3 lru-cache
```

### 2. 复制插件

```bash
# 方式一：从 GitHub 克隆
cd ~/.openclaw/plugins
git clone https://github.com/xcqblue/memory-local-enhanced.git

# 方式二：手动复制
# 将下载的插件文件夹复制到 ~/.openclaw/plugins/
```

### 3. 配置 OpenClaw

编辑 `~/.openclaw/openclaw.json`:

```json
{
  "plugins": {
    "allow": ["memory-local-enhanced"],
    "entries": {
      "memory-local-enhanced": {
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

---

## 配置说明

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|---------|------|
| autoCapture | boolean | true | 自动存储对话 |
| autoRecall | boolean | true | 自动召回记忆 |
| recencyDecay | boolean | true | 启用时间衰减 |
| recencyHalfLife | number | 90 | 半衰期(天) |
| smartDedup | boolean | true | 启用智能去重 |
| cleanupDays | number | 90 | 过期清理天数 |
| cacheEnabled | boolean | true | 启用缓存 |
| publicMemory | boolean | false | 公共记忆 |
| llm.enabled | boolean | false | LLM 增强 |

---

## CLI 命令

```bash
# 列出记忆
memory list -a <agent-id>

# 搜索记忆
memory search -a <agent-id> -q <关键词>

# 查看统计
memory stats

# 清理过期
memory cleanup

# 检查更新
memory check-update
```

---

## 卸载

```bash
# 1. 从配置中移除
# 编辑 openclaw.json，删除 plugins 配置

# 2. 删除插件文件夹
rm -rf ~/.openclaw/plugins/memory-local-enhanced

# 3. (可选) 删除数据
rm -rf ~/.openclaw/memory-enhanced
```

---

## 常见问题

### Q: 依赖安装失败？
A: 确保 Node.js 版本 >= 18，可以运行 `node -v` 检查。

### Q: 插件不生效？
A: 检查 openclaw.json 格式是否正确，确保插件名称与文件夹名一致。

### Q: 如何查看记忆？
A: 使用 CLI 命令 `memory list -a <agent-id>` 或直接查看数据库 `.openclaw/memory-enhanced/memories.db`。
