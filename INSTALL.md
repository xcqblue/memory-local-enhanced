# 📖 安装指南

## 环境要求

| 项目 | 最低 | 推荐 |
|------|------|------|
| Node.js | >= 20.0.0 | >= 24.0.0 |
| 内存 | 256MB | 512MB+ |
| 磁盘 | 50MB | 100MB+ |

---

## Ubuntu/Debian 安装

### 1. 安装系统依赖

```bash
# 更新软件源
sudo apt-get update

# 安装编译工具（必需）
sudo apt-get install -y build-essential

# 安装 SQLite3 开发库（必需）
sudo apt-get install -y libsqlite3-dev

# 安装 Python（node-gyp 必需）
sudo apt-get install -y python3
```

### 2. 克隆插件

```bash
# 创建目录
mkdir -p ~/.openclaw/extensions

# 克隆插件
git clone https://github.com/xcqblue/algo-memory.git ~/.openclaw/extensions/algo-memory
```

### 3. 安装 Node 依赖

```bash
cd ~/.openclaw/extensions/algo-memory
npm install
```

---

## CentOS/RHEL 安装

```bash
# 安装依赖
sudo yum install -y gcc-c++ make python3 sqlite-devel

# 克隆和安装
mkdir -p ~/.openclaw/extensions
git clone https://github.com/xcqblue/algo-memory.git ~/.openclaw/extensions/algo-memory
cd ~/.openclaw/extensions/algo-memory
npm install
```

---

## macOS 安装

```bash
# 安装 Xcode（包含编译工具）
xcode-select --install

# 克隆和安装
mkdir -p ~/.openclaw/extensions
git clone https://github.com/xcqblue/algo-memory.git ~/.openclaw/extensions/algo-memory
cd ~/.openclaw/extensions/algo-memory
npm install
```

---

## Windows 安装

```bash
# 使用 PowerShell 或 CMD

# 1. 安装 Node.js (https://nodejs.org/)

# 2. 克隆插件
mkdir %USERPROFILE%\.openclaw\extensions
git clone https://github.com/xcqblue/algo-memory.git %USERPROFILE%\.openclaw\extensions\algo-memory

# 3. 安装依赖
cd %USERPROFILE%\.openclaw\extensions\algo-memory
npm install
```

---

## 验证安装

### 检查日志

```bash
openclaw logs | grep algo-memory
```

预期输出：
```
[algo-memory] 数据库初始化: ~/.openclaw/workspace/algo-memory/memories.db
[algo-memory] FTS5 全文搜索已启用
[algo-memory] 插件注册完成, 工具数: 11, 自动启用: true
```

### 测试工具

在对话中发送：
```
列出我的记忆
```

---

## 常见问题

### Q: npm install 报错 g++: command not found？

**解决**：
```bash
# Ubuntu/Debian
sudo apt-get install build-essential

# CentOS
sudo yum install gcc-c++ make
```

### Q: npm install 报错 SQLite3 not found？

**解决**：
```bash
# Ubuntu/Debian
sudo apt-get install libsqlite3-dev

# CentOS
sudo yum install sqlite-devel
```

### Q: 如何查看数据库？

```bash
# 使用 sqlite3
sqlite3 ~/.openclaw/workspace/algo-memory/memories.db

# 在 SQLite 中
sqlite> .tables
sqlite> SELECT * FROM memories LIMIT 10;
```

---

## 卸载

```bash
# 删除插件目录
rm -rf ~/.openclaw/extensions/algo-memory

# 重启 OpenClaw
openclaw gateway restart
```
