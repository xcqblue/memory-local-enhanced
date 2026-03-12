# memory-local-enhanced

纯算法长期记忆插件 - 0 API / 可选 LLM 增强

## 特性

- ✅ Agent 独立记忆
- ✅ 6 类分类 (preference/fact/event/entity/case/pattern)
- ✅ 两层分层 (core/general)
- ✅ FTS5 全文搜索
- ✅ LRU 缓存
- ✅ 哈希去重
- ✅ 噪声过滤
- ✅ 异步存储
- ✅ 可选 LLM 增强 (MiniMax/OpenAI/Claude/Ollama)
- ✅ 删除 Agent 时清理记忆
- ✅ 轻量高效 (< 50ms)

## 安装

```bash
# 方式 1: npm
npm install memory-local-enhanced

# 方式 2: 复制到 plugins 目录
cp -r memory-local-enhanced ~/.openclaw/plugins/
```

## 配置

在 `openclaw.json` 中添加:

```json
{
  "plugins": {
    "slots": {
      "memory": "memory-local-enhanced"
    },
    "entries": {
      "memory-local-enhanced": {
        "enabled": true,
        "config": {
          "autoCapture": true,
          "autoRecall": true,
          "maxResults": 5,
          "maxContextChars": 500
        }
      }
    }
  }
}
```

## 配置说明

| 配置 | 默认值 | 说明 |
|------|--------|------|
| autoCapture | true | 自动捕获对话中的记忆 |
| autoRecall | true | 自动召回相关记忆 |
| maxResults | 5 | 最大召回数量 |
| maxContextChars | 500 | 上下文最大字符数 |
| cacheEnabled | true | 启用缓存 |
| cleanupDays | 90 | 清理天数 |

## LLM 增强 (可选)

```json
{
  "llm": {
    "enabled": true,
    "provider": "minimax",
    "apiKey": "your-api-key",
    "model": "abab6.5s-chat"
  }
}
```

支持的 provider: minimax, openai, claude, deepseek, ollama

## CLI 命令

```bash
memory list
memory search "query"
memory stats
memory delete-agent <agent-id>
```

## 性能

- 读取: < 50ms
- 缓存命中: < 5ms
- 写入: 异步不阻塞
- 内存: < 30MB

## License

MIT
