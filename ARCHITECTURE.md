# 🏗️ memory-local-enhanced 架构设计

---

## 🔄 核心流程

### 1. 存储流程 (agent_end)

```
用户输入 content
    ↓
[1] 规则分类 → type (6类)
    ↓
[2] LLM增强 (可选，默认关)
    ↓
[3] XSS转义 → safeContent
    ↓
[4] 哈希计算 → contentHash (基于safeContent)
    ↓
[5] 哈希查重
    ├─ 存在 → UPDATE access_count → 返回
    └─ 不存在 ↓
    ↓
[6] 智能去重 (Jaccard)
    ├─ ≥98% → DUPLICATE → UPDATE → 返回
    ├─ ≥85% → UPDATE → 合并内容+keywords → 返回
    └─ <85% ↓
    ↓
[7] 写入新记忆
    ├─ isCoreKeyword() → layer
    ├─ extractKeywords() → keywords
    └─ INSERT + FTS索引
    ↓
[8] 清理缓存
```

### 2. 智能去重策略 (Jaccard)

```
查询最近20条记忆
    ↓
计算 Jaccard 相似度
    ┌─────────────────────────────────┐
    │ ≥98% │ 完全相同 │ DUPLICATE    │
    │ ≥85% │ 高度相似 │ UPDATE       │
    │ <85% │ 新内容   │ NEW         │
    └─────────────────────────────────┘
    ↓
(可选 LLM 精调)
```

### 3. 核心识别

```
isCoreKeyword(content)
    ↓
匹配关键词: 记住/重要/关键/不要忘记/remember/important...
    ↓
是 → layer='core', importance=1.0
否 → layer='general', importance=0.5
```

### 4. 召回流程 (before_agent_start)

```
recall(agentId, query)
    ↓
1. 查缓存 (命中→返回)
2. 搜索 (content/keywords LIKE)
3. 时间衰减计算
   └─ score × (0.3 + 0.7 × 0.5^(t/90天))
4. 排序: core > general > importance > access > recency
5. Token限制
6. 缓存结果
```

### 5. 时间衰减策略

```
公式: score = baseScore × (0.3 + 0.7 × 0.5^(days/90))

| 记忆时间 | 衰减系数 |
|----------|----------|
| 今天     | 1.00×   |
| 30天前  | 0.80×   |
| 60天前  | 0.60×   |
| 90天前  | 0.50×   |
```

### 6. 定时清理

```
每天执行 (延迟1h后)
    ↓
删除: layer='general' + 超过90天
    ↓
保留: layer='core'
```

---

## 🔌 LLM 模型层 (可插拔)

### 支持的提供商

| 提供商 | 端点 | 说明 |
|--------|------|------|
| minimax | /v1 或 /v2 | MiniMax API |
| openai | /chat/completions | OpenAI API |
| claude | /chat/completions | Anthropic API |
| deepseek | /chat/completions | DeepSeek API |
| ollama | /api/generate | 本地模型 |

### LLM 使用场景

1. **类型增强** - 长文本自动识别类型
2. **关键词提取** - 更准确的关键词
3. **智能去重精调** - Jaccard 接近阈值时判断

### 配置示例

```json
{
  "llm": {
    "enabled": false,
    "provider": "minimax",
    "apiKey": "your-key",
    "model": "abab6.5s-chat",
    "baseURL": "https://api.minimax.chat/v1",
    "thresholdLength": 100
  }
}
```

---

## 📊 数据表结构

### memories 表

```sql
CREATE TABLE memories (
    id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL,
    content TEXT NOT NULL,
    type TEXT DEFAULT 'other',
    layer TEXT DEFAULT 'general',
    keywords TEXT,
    importance REAL DEFAULT 0.5,
    access_count INTEGER DEFAULT 0,
    created_at INTEGER,
    last_accessed INTEGER,
    content_hash TEXT,
    owner TEXT,
    source TEXT
);

CREATE INDEX idx_agent ON memories(agent_id);
CREATE INDEX idx_agent_hash ON memories(agent_id, content_hash);
CREATE INDEX idx_layer ON memories(agent_id, layer);
```

### memories_fts 表

```sql
CREATE VIRTUAL TABLE memories_fts USING fts5(
    id UNINDEXED,
    content,
    keywords
);
```

### memory_metadata 表

```sql
CREATE TABLE memory_metadata (
    key TEXT PRIMARY KEY,
    value TEXT
);
```

### 字段说明

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT | 记忆唯一ID |
| agent_id | TEXT | 所属Agent |
| content | TEXT | 记忆内容 |
| type | TEXT | 类型 (preference/fact/event/entity/case/pattern) |
| layer | TEXT | 层 (core/general) |
| keywords | TEXT | JSON格式关键词 |
| importance | REAL | 重要性 (0-1) |
| access_count | INTEGER | 访问次数 |
| created_at | INTEGER | 创建时间戳 |
| last_accessed | INTEGER | 最后访问时间戳 |
| content_hash | TEXT | 内容哈希 |
| owner | TEXT | 所有者 (agent:xxx / public) |
| source | TEXT | 来源 (dialog/migration/skill) |
