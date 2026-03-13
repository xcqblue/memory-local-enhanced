# algo-memory 流程逻辑

## 一、插件加载流程

1. OpenClaw 启动
2. 读取 openclaw.plugin.json
3. 读取 package.json -> openclaw.extensions
4. jiti 加载 src/index.ts
5. 调用 algoMemoryPlugin.register(api)
6. 注册工具和钩子

## 二、工具注册

- algo-memory (插件ID)
- memory_list (列出记忆)
- memory_search (搜索记忆)
- memory_stats (记忆统计)

## 三、钩子注册

- onConversationTurn (对话钩子)
- onDeactivate (关闭钩子)

## 四、对话存储流程

1. 用户发送消息
2. OpenClaw 触发 onConversationTurn
3. 判断 autoCapture 是否为 true
4. 遍历消息:
   - 过滤非用户消息
   - 过滤噪声 (ok/hi/好等)
   - XSS 转义
   - 计算 SHA256 哈希
   - 检查是否重复
   - 判断是否核心记忆
   - 提取关键词
   - 插入 SQLite
5. 返回

## 五、记忆召回流程

1. 用户发送消息
2. OpenClaw 触发 onConversationTurn
3. 判断 autoRecall 是否为 true
4. 检查缓存
5. 查询数据库:
   - 按 agent_id 过滤
   - 核心记忆优先
   - 按重要性/访问次数排序
6. 时间衰减计算
7. 返回 top N 结果

## 六、工具调用

- memory_list: 列出指定 Agent 的记忆
- memory_search: 关键词搜索记忆
- memory_stats: 查看记忆统计 (总数/核心/普通)

## 七、自动清理流程

1. 每24小时执行 cleanup()
2. 计算截止时间 (now - cleanupDays)
3. 删除 layer=general 的过期记忆
4. 保留 layer=core 的核心记忆

## 八、数据结构

memories 表字段:
- id: 记忆ID
- agent_id: Agent ID
- content: 内容
- type: 类型
- layer: 分层 (core/general)
- keywords: 关键词
- importance: 重要性
- access_count: 访问次数
- created_at: 创建时间
- last_accessed: 最后访问
- content_hash: 内容哈希
