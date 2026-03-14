# 📖 安装指南

## 环境要求

| 项目 | 最低 | 推荐 |
|------|------|------|
| Node.js | >= 18.0.0 | >= 20.0.0 |
| 内存 | 256MB | 512MB+ |
| 磁盘 | 50MB | 100MB+ |

---

## 安装方式

### 方式一：extensions 目录（推荐）

```bash
# 1. 克隆插件
mkdir -p ~/.openclaw/extensions
git clone https://github.com/xcqblue/algo-memory.git ~/.openclaw/extensions/algo-memory

# 2. 安装依赖
cd ~/.openclaw/extensions/algo-memory
npm install

# 3. 重启 OpenClaw
openclaw gateway restart
```

### 方式二：plugins 目录

```bash
cd ~/.openclaw/plugins
git clone https://github.com/xcqblue/algo-memory.git
cd algo-memory
npm install
```

---

## 依赖说明

| 依赖 | 类型 | 用途 |
|------|------|------|
| `@sinclair/typebox` | 运行时 | 类型定义 |
| `lru-cache` | 运行时 | 内存缓存 |
| `better-sqlite3` | 运行时 | 数据库 |

**注意**：better-sqlite3 需要编译：
- Linux: `build-essential`
- macOS: `Xcode`
- Windows: `node-gyp`

---

## 验证安装

### 1. 检查日志

```bash
openclaw logs | grep algo-memory
```

预期输出：
```
[algo-memory] 数据库初始化: ~/.openclaw/workspace/algo-memory/memories.db
[algo-memory] FTS5 全文搜索已启用
[algo-memory] 插件注册完成, 工具数: 11, 自动启用: true
```

### 2. 检查工具

在对话中测试：
```
列出我的记忆
```

---

## 卸载

```bash
# 删除插件目录
rm -rf ~/.openclaw/extensions/algo-memory

# 重启 OpenClaw
openclaw gateway restart
```

---

## 常见问题

### Q: 提示 better-sqlite3 找不到？

```bash
# 重新安装
npm install
npm rebuild better-sqlite3
```

### Q: 如何查看数据库？

```bash
# 使用 sqlite3
sqlite3 ~/.openclaw/workspace/algo-memory/memories.db

# 查看表
.tables

# 查看数据
SELECT * FROM memories LIMIT 10;
```

### Q: 如何修改数据存储位置？

在配置中指定：
```json
{
  "dataDir": "/自定义/路径"
}
```
