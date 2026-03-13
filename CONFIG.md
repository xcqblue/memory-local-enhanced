# ⚙️ 配置与 API 参考

---

## ⚙️ 配置说明

### 完整配置

```json
{
  "autoCapture": true,
  "autoRecall": true,
  "maxResults": 5,
  "maxContextChars": 500,
  "cacheEnabled": true,
  "cleanupDays": 90,
  "cleanupDelayHours": 1,
  "coreKeywords": [
    "记住", "牢记", "重要", "不要忘记", "记住它",
    "这是关键", "永久保留", "一直记住", "别忘了",
    "remember", "important", "never forget", "always remember",
    "关键", "核心", "必须记住", "一定要记住"
  ],
  "logLevel": "info",
  "recencyDecay": true,
  "recencyHalfLife": 90,
  "publicMemory": false,
  "smartDedup": true,
  "llm": {
    "enabled": false,
    "provider": "minimax",
    "thresholdLength": 100,
    "apiKey": "",
    "model": "abab6.5s-chat",
    "baseURL": "https://api.minimax.chat/v1"
  }
}
```

### 配置项说明

| 配置 | 类型 | 默认值 | 说明 |
|------|------|---------|------|
| autoCapture | boolean | true | 自动捕获对话 |
| autoRecall | boolean | true | 自动召回记忆 |
| maxResults | number | 5 | 最大召回数量 |
| maxContextChars | number | 500 | 上下文最大字符 |
| cacheEnabled | boolean | true | 启用缓存 |
| cleanupDays | number | 90 | 过期清理天数 |
| cleanupDelayHours | number | 1 | 清理任务延迟启动 |
| coreKeywords | array | [...] | 核心关键词 |
| logLevel | string | info | 日志级别 |
| recencyDecay | boolean | true | 启用时间衰减 |
| recencyHalfLife | number | 90 | 半衰期天数 |
| publicMemory | boolean | false | 启用公共记忆 |
| smartDedup | boolean | true | 启用智能去重 |
| llm.enabled | boolean | false | 启用LLM |
| llm.provider | string | minimax | LLM提供商 |
| llm.thresholdLength | number | 100 | 触发LLM长度 |
| llm.apiKey | string | - | API密钥 |
| llm.model | string | abab6.5s-chat | 模型名称 |
| llm.baseURL | string | minimax | API地址 |

---

## 🔧 CLI 命令

### 基础命令

```bash
# 列出记忆
memory list -a <agent-id> [-l 20]

# 查看单条记忆详情
memory get-detail -i <memory-id>

# 搜索记忆
memory search -a <agent-id> -q <关键词>

# 查看统计
memory stats [-a <agent-id>]
```

### 管理命令

```bash
# 删除 Agent 及所有记忆
memory delete-agent -a <agent-id>

# 删除单条记忆
memory delete-memory -i <memory-id>

# 更新单条记忆
memory update-memory -i <memory-id> -c <新内容>

# 清理过期记忆
memory cleanup
```

### 更新命令

```bash
# 检查更新
memory check-update

# 从 GitHub 更新
memory update

# 从本地文件更新
memory update-file -p <path>

# 增加版本后缀 (当天多次更新)
memory bump-version
```

### 数据命令

```bash
# 导出记忆
memory export [-a <agent-id>]

# 导入记忆
memory import -j <json> [-r <true|false>]
```

---

## 📝 API

### 构造函数

```typescript
import { MemoryPlugin } from './src/index';

const memory = new MemoryPlugin({
  autoCapture: true,
  autoRecall: true,
  maxResults: 5,
  cleanupDays: 90,
  recencyDecay: true,
  recencyHalfLife: 90,
  smartDedup: true
});

await memory.init();
```

### 核心 API

```typescript
// 存储记忆
await memory.store(agentId, messages);

// 召回记忆
const result = await memory.recall(agentId, query);
// 返回: { hasMemory: boolean, memories: Memory[], message: string }

// 删除 Agent 及所有记忆
await memory.deleteAgent(agentId);

// 清理过期记忆
await memory.cleanupExpired();

// 关闭
memory.close();
```

### 管理 API

```typescript
// 手动设置核心记忆
await memory.setCoreMemory(agentId, content, 'fact');

// 标记现有记忆为核心
await memory.markAsCore(memoryId);

// 手动升级
await memory.promoteToCore(agentId, memoryId);

// 删除单条记忆
memory.deleteMemory(memoryId);

// 更新记忆
memory.updateMemory(memoryId, newContent);

// 获取统计
memory.getStats(agentId?);
```

### 查询 API

```typescript
// 列出记忆
memory.listMemories(agentId, limit, offset);

// 获取单条详情
memory.getMemoryDetail(memoryId);

// 搜索
memory.searchMemories(agentId, query, limit);
```

### 高级 API

```typescript
// 写入公共记忆
await memory.writePublicMemory(content, type);

// 智能去重判断
await memory.smartDedup(agentId, content);
// 返回: { result: 'DUPLICATE'|'UPDATE'|'NEW', existingId?: string }

// 检查更新
await memory.checkUpdate();

// 从 GitHub 更新
await memory.updateFromGitHub();

// 从文件更新
await memory.updateFromFile(path);

// 导出记忆
memory.exportMemories(agentId?);

// 导入记忆
memory.importMemories(memories, replace?);
```

### Memory 对象结构

```typescript
interface Memory {
  id: string;
  agent_id: string;
  content: string;
  type: 'preference' | 'fact' | 'event' | 'entity' | 'case' | 'pattern' | 'other';
  layer: 'core' | 'general';
  keywords: string;
  importance: number;
  access_count: number;
  created_at: number;
  last_accessed: number;
  content_hash: string;
  owner?: string;
  source?: string;
}
```

### RecallResult 对象结构

```typescript
interface RecallResult {
  hasMemory: boolean;
  memories: Memory[];
  message: string;
}
```

---

## 📊 功能矩阵

| 功能 | 默认状态 |
|------|---------|
| 自动存储 | ✅ 开 |
| 6类分类 | ✅ 开 |
| 核心自动识别 | ✅ 开 |
| 哈希去重 | ✅ 开 |
| 智能去重 (Jaccard) | ✅ **开** |
| 时间衰减 | ✅ **开** |
| LRU缓存 | ✅ 开 |
| XSS防护 | ✅ 开 |
| 定时清理 | ✅ 开 |
| 公共记忆 | ⭐ 关 |
| LLM增强 | ⭐ 关 |
