/**
 * algo-memory
 * 纯算法长期记忆插件 - 0 API / 可选 LLM 增强
 * 遵循官方 OpenClaw register(api) 规范
 * 
 * 功能:
 * - 自动存储/召回
 * - 智能去重 (Jaccard)
 * - 核心记忆识别
 * - 时间衰减
 * - LLM 阈值介入 (可选)
 */

import LRUCache from 'lru-cache';
import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

// ============= 配置 =============
interface Config {
  autoCapture: boolean;
  autoRecall: boolean;
  maxResults: number;
  cleanupDays: number;
  coreKeywords: string[];
  recencyDecay: boolean;
  recencyHalfLife: number;
  smartDedup: boolean;
  dedupThreshold: number;
  // LLM 配置 (可选)
  llm: {
    enabled: boolean;
    provider: string;
    apiKey: string;
    model: string;
    baseURL: string;
  };
  // LLM 阈值配置
  threshold: {
    useLlmForCore: boolean;
    useLlmForExtract: boolean;
    useLlmForDedup: boolean;
    minConfidence: number;
  };
}

const DEFAULT_CONFIG: Config = {
  autoCapture: true,
  autoRecall: true,
  maxResults: 5,
  cleanupDays: 180,
  coreKeywords: [
    '记住', '牢记', '重要', '不要忘记', '记住它',
    '这是关键', '永久保留', '一直记住', '别忘了',
    'remember', 'important', 'never forget', 'always remember'
  ],
  recencyDecay: true,
  recencyHalfLife: 180,
  smartDedup: true,
  dedupThreshold: 0.85,
  // LLM 默认关闭
  llm: {
    enabled: false,
    provider: 'openai',
    apiKey: '',
    model: 'gpt-4o-mini',
    baseURL: 'https://api.openai.com/v1'
  },
  // 阈值默认开启本地判断
  threshold: {
    useLlmForCore: false,
    useLlmForExtract: false,
    useLlmForDedup: false,
    minConfidence: 0.8
  }
};

// ============= 工具函数 =============
function generateId(): string {
  return 'mem_' + crypto.randomBytes(8).toString('hex');
}

function hashContent(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function extractKeywords(content: string): string {
  const words = content.toLowerCase().match(/[\u4e00-\u9fa5a-zA-Z0-9]{2,}/g) || [];
  return [...new Set(words)].slice(0, 10).join(',');
}

function isCoreKeyword(content: string, keywords: string[]): boolean {
  return keywords.some(k => content.includes(k));
}

function isNoise(content: string): boolean {
  const lower = content.toLowerCase().trim();
  const patterns = [
    /^hi|^hello|^hey/i,
    /^好的|^收到|^了解|^ok|^okay|^好滴|^明白了/i,
    /^(thanks|thank you)/i,
    /^[\s]*$/,
    /^[\.。!?！?]+$/
  ];
  return patterns.some(p => p.test(lower));
}

// Jaccard 相似度计算
function jaccardSimilarity(text1: string, text2: string): number {
  const words1 = new Set(text1.toLowerCase().match(/[\u4e00-\u9fa5a-zA-Z0-9]{2,}/g) || []);
  const words2 = new Set(text2.toLowerCase().match(/[\u4e00-\u9fa5a-zA-Z0-9]{2,}/g) || []);
  if (words1.size === 0 || words2.size === 0) return 0;
  const intersection = new Set([...words1].filter(x => words2.has(x)));
  const union = new Set([...words1, ...words2]);
  return intersection.size / union.size;
}

// ============= LLM 客户端 =============
class LLMClient {
  private config: Config['llm'];
  private log: any;

  constructor(config: Config['llm'], log: any) {
    this.config = config;
    this.log = log;
  }

  // 判断是否为核心记忆 (可选 LLM)
  async isCoreMemory(content: string): Promise<{ isCore: boolean; confidence: number }> {
    // 本地判断
    const localResult = isCoreKeyword(content, DEFAULT_CONFIG.coreKeywords);
    if (localResult) {
      return { isCore: true, confidence: 1.0 };
    }

    // 如果未启用 LLM，返回本地结果
    if (!this.config.enabled) {
      return { isCore: false, confidence: 0.5 };
    }

    // LLM 判断
    try {
      const response = await fetch(`${this.config.baseURL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.apiKey}`
        },
        body: JSON.stringify({
          model: this.config.model,
          messages: [{
            role: 'system',
            content: '判断用户输入是否包含重要信息需要长期记住。回复JSON: {"isCore": true/false, "confidence": 0-1}'
          }, {
            role: 'user',
            content: content
          }],
          max_tokens: 100,
          temperature: 0.1
        })
      });

      const data = await response.json();
      const result = JSON.parse(data.choices[0].message.content);
      return result;
    } catch (err) {
      this.log.error('[algo-memory] LLM调用失败:', err);
      return { isCore: false, confidence: 0.5 };
    }
  }

  // 提取关键词 (可选 LLM)
  async extractKeywords(content: string): Promise<string> {
    // 本地提取
    const localKeywords = extractKeywords(content);

    // 如果未启用 LLM，返回本地结果
    if (!this.config.enabled) {
      return localKeywords;
    }

    // LLM 提取
    try {
      const response = await fetch(`${this.config.baseURL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.apiKey}`
        },
        body: JSON.stringify({
          model: this.config.model,
          messages: [{
            role: 'system',
            content: '提取关键信息作为关键词，用逗号分隔，最多10个。回复JSON: {"keywords": ["关键词1", "关键词2"]}'
          }, {
            role: 'user',
            content: content
          }],
          max_tokens: 200,
          temperature: 0.2
        })
      });

      const data = await response.json();
      const result = JSON.parse(data.choices[0].message.content);
      return result.keywords.join(',');
    } catch (err) {
      this.log.error('[algo-memory] LLM关键词提取失败:', err);
      return localKeywords;
    }
  }

  // 判断是否重复 (可选 LLM)
  async isDuplicate(content1: string, content2: string): Promise<{ isDuplicate: boolean; similarity: number }> {
    // 本地判断
    const localSimilarity = jaccardSimilarity(content1, content2);
    if (localSimilarity >= 0.98 || localSimilarity < 0.5) {
      return { isDuplicate: localSimilarity >= 0.98, similarity: localSimilarity };
    }

    // 如果未启用 LLM，返回本地结果
    if (!this.config.enabled) {
      return { isDuplicate: false, similarity: localSimilarity };
    }

    // LLM 判断
    try {
      const response = await fetch(`${this.config.baseURL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.apiKey}`
        },
        body: JSON.stringify({
          model: this.config.model,
          messages: [{
            role: 'system',
            content: '判断两段内容是否重复/相似。回复JSON: {"isDuplicate": true/false, "similarity": 0-1}'
          }, {
            role: 'user',
            content: `内容1: ${content1}\n内容2: ${content2}`
          }],
          max_tokens: 100,
          temperature: 0.1
        })
      });

      const data = await response.json();
      return JSON.parse(data.choices[0].message.content);
    } catch (err) {
      this.log.error('[algo-memory] LLM去重判断失败:', err);
      return { isDuplicate: localSimilarity >= 0.85, similarity: localSimilarity };
    }
  }
}

// ============= 核心类 =============
class MemoryPlugin {
  private db: Database.Database | null = null;
  private cache: LRUCache<string, any>;
  private cleanupInterval: NodeJS.Timeout | null = null;
  private config: Config;
  private llmClient: LLMClient | null = null;
  private log: any;

  constructor(config: Partial<Config>, log: any = console) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.log = log;
    this.cache = new LRUCache({ max: 100, ttl: 5 * 60 * 1000 });
    
    // 初始化 LLM 客户端
    if (this.config.llm.enabled) {
      this.llmClient = new LLMClient(this.config.llm, log);
    }
  }

  async init(stateDir: string): Promise<void> {
    if (!fs.existsSync(stateDir)) {
      fs.mkdirSync(stateDir, { recursive: true });
    }

    const dbPath = path.join(stateDir, 'memories.db');
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('busy_timeout = 5000');

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memories (
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
        content_hash TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_agent ON memories(agent_id);
      CREATE INDEX IF NOT EXISTS idx_agent_hash ON memories(agent_id, content_hash);
      CREATE INDEX IF NOT EXISTS idx_layer ON memories(agent_id, layer);
    `);

    this.log.info('[algo-memory] 数据库初始化完成:', dbPath);
    this.cleanupInterval = setInterval(() => this.cleanup(), 24 * 60 * 60 * 1000);
  }

  async store(AgentId: string, messages: any[]): Promise<void> {
    if (!AgentId || !messages?.length || !this.db) return;

    for (const msg of messages) {
      if (msg.role !== 'user' || isNoise(msg.content)) continue;

      const content = msg.content.replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const contentHash = hashContent(content);

      // 精确查重
      const existing = this.db.prepare(
        'SELECT id, content FROM memories WHERE agent_id = ? AND content_hash = ?'
      ).get(AgentId, contentHash) as { id: string; content: string } | undefined;

      if (existing) {
        this.db.prepare('UPDATE memories SET access_count = access_count + 1, last_accessed = ? WHERE id = ?')
          .run(Date.now(), existing.id);
        this.cache.delete(`recall:${AgentId}`);
        continue;
      }

      // 智能去重 (可选 LLM)
      if (this.config.smartDedup) {
        const similar = this.db.prepare(
          "SELECT id, content FROM memories WHERE agent_id = ? ORDER BY created_at DESC LIMIT 10"
        ).all(AgentId) as { id: string; content: string }[];

        for (const s of similar) {
          // 使用 LLM 判断或本地判断
          let isDup = false;
          let score = jaccardSimilarity(content, s.content);
          
          if (this.config.threshold.useLlmForDedup && this.llmClient && score >= 0.5 && score < 0.98) {
            const llmResult = await this.llmClient.isDuplicate(content, s.content);
            isDup = llmResult.isDuplicate;
            score = llmResult.similarity;
          } else if (score >= 0.98) {
            isDup = true;
          }

          if (isDup) {
            this.db.prepare('UPDATE memories SET access_count = access_count + 1, last_accessed = ? WHERE id = ?')
              .run(Date.now(), s.id);
            this.cache.delete(`recall:${AgentId}`);
            break;
          }
        }
        continue;
      }

      // 判断是否核心记忆 (可选 LLM)
      let isCore = isCoreKeyword(content, this.config.coreKeywords);
      let keywords = extractKeywords(content);
      let importance = isCore ? 1.0 : 0.5;

      if (this.config.threshold.useLlmForCore && this.llmClient && !isCore) {
        const llmResult = await this.llmClient.isCoreMemory(content);
        isCore = llmResult.isCore;
        importance = llmResult.confidence;
      }

      // 提取关键词 (可选 LLM)
      if (this.config.threshold.useLlmForExtract && this.llmClient) {
        keywords = await this.llmClient.extractKeywords(content);
      }

      // 写入数据库
      const memory = {
        id: generateId(),
        agent_id: AgentId,
        content,
        type: 'other',
        layer: isCore ? 'core' : 'general',
        keywords,
        importance,
        access_count: 1,
        created_at: Date.now(),
        last_accessed: Date.now(),
        content_hash: contentHash
      };

      this.db.prepare(`
        INSERT INTO memories (id, agent_id, content, type, layer, keywords, importance, access_count, created_at, last_accessed, content_hash)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        memory.id, memory.agent_id, memory.content, memory.type, memory.layer,
        memory.keywords, memory.importance, memory.access_count,
        memory.created_at, memory.last_accessed, memory.content_hash
      );
    }
  }

  async recall(AgentId: string, query: string): Promise<{ hasMemory: boolean; memories: any[] }> {
    const cacheKey = `recall:${AgentId}:${query}`;
    if (this.cache.has(cacheKey)) return this.cache.get(cacheKey)!;

    let memories = this.db!.prepare(
      "SELECT * FROM memories WHERE agent_id = ? ORDER BY CASE layer WHEN 'core' THEN 0 ELSE 1 END, importance DESC, access_count DESC LIMIT ?"
    ).all(AgentId, this.config.maxResults * 2) as any[];

    if (this.config.recencyDecay) {
      const halfLife = this.config.recencyHalfLife || 180;
      memories = memories.map(m => ({
        ...m,
        _score: (m.layer === 'core' ? 1.5 : 1.0) * m.importance * m.access_count *
          (0.3 + 0.7 * Math.pow(0.5, (Date.now() - m.last_accessed) / (1000 * 60 * 60 * 24 * halfLife)))
      })).sort((a: any, b: any) => b._score - a._score);
    }

    const limited = memories.slice(0, this.config.maxResults);
    const result = { hasMemory: limited.length > 0, memories: limited };
    this.cache.set(cacheKey, result);
    return result;
  }

  cleanup(): void {
    if (!this.db) return;
    const cutoff = Date.now() - this.config.cleanupDays * 24 * 60 * 60 * 1000;
    const result = this.db.prepare('DELETE FROM memories WHERE last_accessed < ? AND layer = "general"').run(cutoff);
    this.log.info('[algo-memory] 清理了', result.changes, '条过期记忆');
  }

  // 工具方法
  listMemories(AgentId: string, limit: number = 20): any[] {
    return this.db!.prepare('SELECT * FROM memories WHERE agent_id = ? ORDER BY created_at DESC LIMIT ?').all(AgentId, limit);
  }

  searchMemories(AgentId: string, query: string): any[] {
    const q = `%${query}%`;
    return this.db!.prepare('SELECT * FROM memories WHERE agent_id = ? AND (content LIKE ? OR keywords LIKE ?) ORDER BY importance DESC LIMIT 20').all(AgentId, q, q);
  }

  getStats(AgentId: string): { total: number; core: number; general: number } {
    const total = this.db!.prepare('SELECT COUNT(*) as count FROM memories WHERE agent_id = ?').get(AgentId) as { count: number };
    const core = this.db!.prepare('SELECT COUNT(*) as count FROM memories WHERE agent_id = ? AND layer = "core"').get(AgentId) as { count: number };
    const general = this.db!.prepare('SELECT COUNT(*) as count FROM memories WHERE agent_id = ? AND layer = "general"').get(AgentId) as { count: number };
    return { total: total.count, core: core.count, general: general.count };
  }

  getMemory(AgentId: string, memoryId: string): any | null {
    return this.db!.prepare('SELECT * FROM memories WHERE id = ? AND agent_id = ?').get(memoryId, AgentId) || null;
  }

  deleteMemory(AgentId: string, memoryId: string): boolean {
    const result = this.db!.prepare('DELETE FROM memories WHERE id = ? AND agent_id = ?').run(memoryId, AgentId);
    this.cache.delete(`recall:${AgentId}`);
    return result.changes > 0;
  }

  clearMemories(AgentId: string, keepCore: boolean = true): number {
    let result;
    if (keepCore) {
      result = this.db!.prepare('DELETE FROM memories WHERE agent_id = ? AND layer != "core"').run(AgentId);
    } else {
      result = this.db!.prepare('DELETE FROM memories WHERE agent_id = ?').run(AgentId);
    }
    this.cache.delete(`recall:${AgentId}`);
    return result.changes;
  }

  updateMemory(AgentId: string, memoryId: string, content: string): boolean {
    const safeContent = content.replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const isCore = isCoreKeyword(safeContent, this.config.coreKeywords);
    const result = this.db!.prepare(
      'UPDATE memories SET content = ?, layer = ?, keywords = ?, importance = ?, last_accessed = ? WHERE id = ? AND agent_id = ?'
    ).run(safeContent, isCore ? 'core' : 'general', extractKeywords(safeContent), isCore ? 1.0 : 0.5, Date.now(), memoryId, AgentId);
    this.cache.delete(`recall:${AgentId}`);
    return result.changes > 0;
  }

  close(): void {
    if (this.cleanupInterval) { clearInterval(this.cleanupInterval); this.cleanupInterval = null; }
    if (this.db) { this.db.close(); this.db = null; }
    this.log.info('[algo-memory] 插件关闭');
  }
}

// ============= 插件定义 =============
const algoMemoryPlugin = {
  id: 'algo-memory',
  name: 'algo-memory',
  description: '纯算法长期记忆插件 - 0 API，可选 LLM 增强',
  kind: 'memory' as const,

  register(api: any): void {
    const log = api.logger || console;
    const plugin = new MemoryPlugin(api.pluginConfig || {}, log);

    const stateDir = api.getStateDir?.() || path.join(process.env.HOME || '/home/x', '.openclaw', 'workspace', 'algo-memory');
    plugin.init(stateDir);

    // 工具: memory_list
    api.registerTool({
      name: 'memory_list',
      label: 'Memory List',
      description: '列出某Agent的记忆',
      parameters: {
        type: 'object',
        properties: {
          agentId: { type: 'string', description: 'Agent ID' },
          limit: { type: 'number', description: '返回数量限制' }
        },
        required: ['agentId']
      },
      async execute(_toolCallId: string, params: any) {
        try {
          const { agentId, limit = 20 } = params;
          const memories = plugin.listMemories(agentId, limit);
          return { content: [{ type: 'text', text: JSON.stringify(memories) }] };
        } catch (err: any) {
          return { content: [{ type: 'text', text: 'Error: ' + String(err) }], isError: true };
        }
      }
    });

    // 工具: memory_search
    api.registerTool({
      name: 'memory_search',
      label: 'Memory Search',
      description: '搜索记忆',
      parameters: {
        type: 'object',
        properties: {
          agentId: { type: 'string', description: 'Agent ID' },
          query: { type: 'string', description: '搜索关键词' }
        },
        required: ['agentId', 'query']
      },
      async execute(_toolCallId: string, params: any) {
        try {
          const { agentId, query } = params;
          const memories = plugin.searchMemories(agentId, query);
          return { content: [{ type: 'text', text: JSON.stringify(memories) }] };
        } catch (err: any) {
          return { content: [{ type: 'text', text: 'Error: ' + String(err) }], isError: true };
        }
      }
    });

    // 工具: memory_stats
    api.registerTool({
      name: 'memory_stats',
      label: 'Memory Stats',
      description: '查看记忆统计',
      parameters: {
        type: 'object',
        properties: {
          agentId: { type: 'string', description: 'Agent ID' }
        },
        required: ['agentId']
      },
      async execute(_toolCallId: string, params: any) {
        try {
          const { agentId } = params;
          const stats = plugin.getStats(agentId);
          return { content: [{ type: 'text', text: JSON.stringify(stats) }] };
        } catch (err: any) {
          return { content: [{ type: 'text', text: 'Error: ' + String(err) }], isError: true };
        }
      }
    });

    // 工具: memory_get
    api.registerTool({
      name: 'memory_get',
      label: 'Memory Get',
      description: '获取单条记忆',
      parameters: {
        type: 'object',
        properties: {
          agentId: { type: 'string', description: 'Agent ID' },
          memoryId: { type: 'string', description: '记忆 ID' }
        },
        required: ['agentId', 'memoryId']
      },
      async execute(_toolCallId: string, params: any) {
        try {
          const { agentId, memoryId } = params;
          const memory = plugin.getMemory(agentId, memoryId);
          return { content: [{ type: 'text', text: JSON.stringify(memory) }] };
        } catch (err: any) {
          return { content: [{ type: 'text', text: 'Error: ' + String(err) }], isError: true };
        }
      }
    });

    // 工具: memory_delete
    api.registerTool({
      name: 'memory_delete',
      label: 'Memory Delete',
      description: '删除记忆',
      parameters: {
        type: 'object',
        properties: {
          agentId: { type: 'string', description: 'Agent ID' },
          memoryId: { type: 'string', description: '记忆 ID' }
        },
        required: ['agentId', 'memoryId']
      },
      async execute(_toolCallId: string, params: any) {
        try {
          const { agentId, memoryId } = params;
          const deleted = plugin.deleteMemory(agentId, memoryId);
          return { content: [{ type: 'text', text: JSON.stringify({ success: deleted }) }] };
        } catch (err: any) {
          return { content: [{ type: 'text', text: 'Error: ' + String(err) }], isError: true };
        }
      }
    });

    // 工具: memory_clear
    api.registerTool({
      name: 'memory_clear',
      label: 'Memory Clear',
      description: '清空记忆',
      parameters: {
        type: 'object',
        properties: {
          agentId: { type: 'string', description: 'Agent ID' },
          keepCore: { type: 'boolean', description: '是否保留核心记忆', default: true }
        },
        required: ['agentId']
      },
      async execute(_toolCallId: string, params: any) {
        try {
          const { agentId, keepCore = true } = params;
          const count = plugin.clearMemories(agentId, keepCore);
          return { content: [{ type: 'text', text: JSON.stringify({ deleted: count }) }] };
        } catch (err: any) {
          return { content: [{ type: 'text', text: 'Error: ' + String(err) }], isError: true };
        }
      }
    });

    // 工具: memory_update
    api.registerTool({
      name: 'memory_update',
      label: 'Memory Update',
      description: '更新记忆',
      parameters: {
        type: 'object',
        properties: {
          agentId: { type: 'string', description: 'Agent ID' },
          memoryId: { type: 'string', description: '记忆 ID' },
          content: { type: 'string', description: '新内容' }
        },
        required: ['agentId', 'memoryId', 'content']
      },
      async execute(_toolCallId: string, params: any) {
        try {
          const { agentId, memoryId, content } = params;
          const updated = plugin.updateMemory(agentId, memoryId, content);
          return { content: [{ type: 'text', text: JSON.stringify({ success: updated }) }] };
        } catch (err: any) {
          return { content: [{ type: 'text', text: 'Error: ' + String(err) }], isError: true };
        }
      }
    });

    // 事件钩子
    api.on('agent_end', async (event: any, ctx: any) => {
      const sessionKey = ctx.sessionKey || 'default';
      const messages = ctx.messages || [];
      if (DEFAULT_CONFIG.autoCapture && messages.length > 0) {
        await plugin.store(sessionKey, messages);
      }
    });

    api.onConversationTurn(async (messages: any[], sessionKey: string, owner: string) => {
      const agentId = sessionKey || 'default';
      if (DEFAULT_CONFIG.autoCapture) await plugin.store(agentId, messages);
      if (DEFAULT_CONFIG.autoRecall) {
        const userMsg = messages.find((m: any) => m.role === 'user');
        if (userMsg) {
          const result = await plugin.recall(agentId, userMsg.content || '');
          if (result.hasMemory) { /* 注入上下文 */ }
        }
      }
    });

    api.onDeactivate(() => plugin.close());
    log.info('[algo-memory] 插件注册完成, 工具数: 7, LLM: ' + (api.pluginConfig?.llm?.enabled ? '启用' : '关闭'));
  }
};

export default algoMemoryPlugin;
