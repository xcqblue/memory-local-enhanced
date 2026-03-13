/**
 * algo-memory
 * 纯算法长期记忆插件 - 0 API / 可选 LLM 增强
 * 借鉴 memory-lancedb-pro 优化
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
  // 噪声过滤
  noiseFilter: {
    enabled: boolean;
    skipGreetings: boolean;
    skipCommands: boolean;
  };
  // 自适应检索
  adaptiveRetrieval: {
    enabled: boolean;
    minQueryLength: number;
  };
  // Session 记忆
  sessionMemory: {
    enabled: boolean;
    maxSessionItems: number;
  };
  // Weibull 衰减
  weibullDecay: {
    enabled: boolean;
    shape: number;
    scale: number;
  };
  // 多 Scope 隔离
  scopes: {
    enabled: boolean;
    defaultScope: string;
  };
  // LLM 配置
  llm: {
    enabled: boolean;
    provider: string;
    apiKey: string;
    model: string;
    baseURL: string;
  };
  // 阈值配置
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
  // 噪声过滤
  noiseFilter: {
    enabled: true,
    skipGreetings: true,
    skipCommands: true
  },
  // 自适应检索
  adaptiveRetrieval: {
    enabled: true,
    minQueryLength: 2
  },
  // Session 记忆
  sessionMemory: {
    enabled: false,
    maxSessionItems: 10
  },
  // Weibull 衰减
  weibullDecay: {
    enabled: false,
    shape: 1.5,
    scale: 90
  },
  // 多 Scope 隔离
  scopes: {
    enabled: false,
    defaultScope: 'agent'
  },
  // LLM
  llm: {
    enabled: false,
    provider: 'openai',
    apiKey: '',
    model: 'gpt-4o-mini',
    baseURL: 'https://api.openai.com/v1'
  },
  // 阈值
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

// 噪声过滤 (借鉴 memory-lancedb-pro)
function isNoise(content: string, config: Config['noiseFilter']): boolean {
  if (!config.enabled) return false;
  const lower = content.toLowerCase().trim();
  
  // 问候语
  if (config.skipGreetings) {
    const greetings = ['hi', 'hello', 'hey', '你好', '您好', '嗨', 'hey'];
    if (greetings.some(g => lower === g || lower.startsWith(g + ' '))) return true;
  }
  
  // 命令
  if (config.skipCommands) {
    if (lower.startsWith('/') || lower.startsWith('!') || lower.startsWith('-')) return true;
  }
  
  // 简单确认
  const confirms = ['ok', 'okay', '好', '好的', '收到', '了解', '明白', 'yes', 'no', '嗯', '哦'];
  if (confirms.includes(lower)) return true;
  
  // 空内容
  if (!lower || /^[.。!?！?\s]+$/.test(lower)) return true;
  
  return false;
}

// 自适应检索判断
function shouldRetrieve(query: string, config: Config['adaptiveRetrieval']): boolean {
  if (!config.enabled) return true;
  if (!query || query.trim().length < config.minQueryLength) return false;
  
  // 特殊词不检索
  const skipWords = ['什么是', '怎么', '如何', '为什么'];
  for (const w of skipWords) {
    if (query.includes(w)) return true;
  }
  
  return true;
}

// Jaccard 相似度
function jaccardSimilarity(text1: string, text2: string): number {
  const words1 = new Set(text1.toLowerCase().match(/[\u4e00-\u9fa5a-zA-Z0-9]{2,}/g) || []);
  const words2 = new Set(text2.toLowerCase().match(/[\u4e00-\u9fa5a-zA-Z0-9]{2,}/g) || []);
  if (words1.size === 0 || words2.size === 0) return 0;
  const intersection = new Set([...words1].filter(x => words2.has(x)));
  const union = new Set([...words1, ...words2]);
  return intersection.size / union.size;
}

// Weibull 衰减 (借鉴 memory-lancedb-pro)
function weibullDecay(daysOld: number, shape: number, scale: number): number {
  return Math.exp(-Math.pow(daysOld / scale, shape));
}

// ============= LLM 客户端 =============
class LLMClient {
  private config: Config['llm'];
  private log: any;

  constructor(config: Config['llm'], log: any) {
    this.config = config;
    this.log = log;
  }

  async isCoreMemory(content: string): Promise<{ isCore: boolean; confidence: number }> {
    const localResult = isCoreKeyword(content, DEFAULT_CONFIG.coreKeywords);
    if (localResult) return { isCore: true, confidence: 1.0 };
    if (!this.config.enabled) return { isCore: false, confidence: 0.5 };

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
            content: '判断是否重要需要长期记住。回复JSON: {"isCore": true/false, "confidence": 0-1}'
          }, { role: 'user', content }],
          max_tokens: 100,
          temperature: 0.1
        })
      });
      const data = await response.json();
      return JSON.parse(data.choices[0].message.content);
    } catch (err) {
      this.log.error('[algo-memory] LLM错误:', err);
      return { isCore: false, confidence: 0.5 };
    }
  }

  async extractKeywords(content: string): Promise<string> {
    const localKeywords = extractKeywords(content);
    if (!this.config.enabled) return localKeywords;

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
            content: '提取关键词，最多10个。回复JSON: {"keywords": ["k1", "k2"]}'
          }, { role: 'user', content }],
          max_tokens: 200,
          temperature: 0.2
        })
      });
      const data = await response.json();
      const result = JSON.parse(data.choices[0].message.content);
      return result.keywords.join(',');
    } catch (err) {
      this.log.error('[algo-memory] LLM错误:', err);
      return localKeywords;
    }
  }

  async isDuplicate(content1: string, content2: string): Promise<{ isDuplicate: boolean; similarity: number }> {
    const localSimilarity = jaccardSimilarity(content1, content2);
    if (localSimilarity >= 0.98 || localSimilarity < 0.5) {
      return { isDuplicate: localSimilarity >= 0.98, similarity: localSimilarity };
    }
    if (!this.config.enabled) return { isDuplicate: false, similarity: localSimilarity };

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
            content: '判断是否重复。回复JSON: {"isDuplicate": true/false, "similarity": 0-1}'
          }, { role: 'user', content: `内容1: ${content1}\n内容2: ${content2}` }],
          max_tokens: 100,
          temperature: 0.1
        })
      });
      const data = await response.json();
      return JSON.parse(data.choices[0].message.content);
    } catch (err) {
      return { isDuplicate: localSimilarity >= 0.85, similarity: localSimilarity };
    }
  }
}

// ============= 核心类 =============
class MemoryPlugin {
  private db: Database.Database | null = null;
  private cache: LRUCache<string, any>;
  private sessionCache: LRUCache<string, any>;
  private cleanupInterval: NodeJS.Timeout | null = null;
  private config: Config;
  private llmClient: LLMClient | null = null;
  private log: any;

  constructor(config: Partial<Config>, log: any = console) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.log = log;
    this.cache = new LRUCache({ max: 100, ttl: 5 * 60 * 1000 });
    this.sessionCache = new LRUCache({ max: 50, ttl: 30 * 60 * 1000 });
    
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
        scope TEXT DEFAULT 'agent',
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
      CREATE INDEX IF NOT EXISTS idx_scope ON memories(scope);
      CREATE INDEX IF NOT EXISTS idx_agent_hash ON memories(agent_id, content_hash);
      CREATE INDEX IF NOT EXISTS idx_layer ON memories(agent_id, layer);
    `);

    this.log.info('[algo-memory] 数据库初始化:', dbPath);
    this.cleanupInterval = setInterval(() => this.cleanup(), 24 * 60 * 60 * 1000);
  }

  async store(AgentId: string, messages: any[]): Promise<void> {
    if (!AgentId || !messages?.length || !this.db) return;

    for (const msg of messages) {
      if (msg.role !== 'user') continue;
      
      // 噪声过滤
      if (isNoise(msg.content, this.config.noiseFilter)) continue;

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

      // 智能去重
      if (this.config.smartDedup) {
        const similar = this.db.prepare(
          "SELECT id, content FROM memories WHERE agent_id = ? ORDER BY created_at DESC LIMIT 10"
        ).all(AgentId) as { id: string; content: string }[];

        for (const s of similar) {
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

      // 判断核心
      let isCore = isCoreKeyword(content, this.config.coreKeywords);
      let keywords = extractKeywords(content);
      let importance = isCore ? 1.0 : 0.5;

      if (this.config.threshold.useLlmForCore && this.llmClient && !isCore) {
        const llmResult = await this.llmClient.isCoreMemory(content);
        isCore = llmResult.isCore;
        importance = llmResult.confidence;
      }

      if (this.config.threshold.useLlmForExtract && this.llmClient) {
        keywords = await this.llmClient.extractKeywords(content);
      }

      // 写入
      const scope = this.config.scopes.enabled ? `${this.config.scopes.defaultScope}:${AgentId}` : 'global';
      const memory = {
        id: generateId(),
        agent_id: AgentId,
        scope,
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
        INSERT INTO memories (id, agent_id, scope, content, type, layer, keywords, importance, access_count, created_at, last_accessed, content_hash)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        memory.id, memory.agent_id, memory.scope, memory.content, memory.type, memory.layer,
        memory.keywords, memory.importance, memory.access_count,
        memory.created_at, memory.last_accessed, memory.content_hash
      );
    }
  }

  async recall(AgentId: string, query: string): Promise<{ hasMemory: boolean; memories: any[] }> {
    // 自适应检索
    if (!shouldRetrieve(query, this.config.adaptiveRetrieval)) {
      return { hasMemory: false, memories: [] };
    }

    const cacheKey = `recall:${AgentId}:${query}`;
    if (this.cache.has(cacheKey)) return this.cache.get(cacheKey)!;

    let memories = this.db!.prepare(
      "SELECT * FROM memories WHERE agent_id = ? ORDER BY CASE layer WHEN 'core' THEN 0 ELSE 1 END, importance DESC, access_count DESC LIMIT ?"
    ).all(AgentId, this.config.maxResults * 2) as any[];

    if (this.config.recencyDecay) {
      const halfLife = this.config.recencyHalfLife || 180;
      memories = memories.map(m => {
        let score = (m.layer === 'core' ? 1.5 : 1.0) * m.importance * m.access_count;
        
        // Weibull 衰减
        if (this.config.weibullDecay.enabled) {
          const daysOld = (Date.now() - m.last_accessed) / (1000 * 60 * 60 * 24);
          score *= weibullDecay(daysOld, this.config.weibullDecay.shape, this.config.weibullDecay.scale);
        } else {
          score *= (0.3 + 0.7 * Math.pow(0.5, (Date.now() - m.last_accessed) / (1000 * 60 * 60 * 24 * halfLife)));
        }
        return { ...m, _score: score };
      }).sort((a: any, b: any) => b._score - a._score);
    }

    const limited = memories.slice(0, this.config.maxResults);
    const result = { hasMemory: limited.length > 0, memories: limited };
    this.cache.set(cacheKey, result);
    return result;
  }

  // Session 记忆
  addSessionMemory(AgentId: string, content: string): void {
    if (!this.config.sessionMemory.enabled) return;
    const key = `session:${AgentId}`;
    const session = this.sessionCache.get(key) || [];
    session.unshift({ content, time: Date.now() });
    if (session.length > this.config.sessionMemory.maxSessionItems) {
      session.pop();
    }
    this.sessionCache.set(key, session);
  }

  getSessionMemory(AgentId: string): any[] {
    if (!this.config.sessionMemory.enabled) return [];
    return this.sessionCache.get(`session:${AgentId}`) || [];
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

    // 工具注册 (7个)
    const tools = [
      { name: 'memory_list', label: 'Memory List', desc: '列出记忆', params: { agentId: 'string', limit: 'number' } },
      { name: 'memory_search', label: 'Memory Search', desc: '搜索记忆', params: { agentId: 'string', query: 'string' } },
      { name: 'memory_stats', label: 'Memory Stats', desc: '查看统计', params: { agentId: 'string' } },
      { name: 'memory_get', label: 'Memory Get', desc: '获取单条', params: { agentId: 'string', memoryId: 'string' } },
      { name: 'memory_delete', label: 'Memory Delete', desc: '删除记忆', params: { agentId: 'string', memoryId: 'string' } },
      { name: 'memory_clear', label: 'Memory Clear', desc: '清空记忆', params: { agentId: 'string', keepCore: 'boolean' } },
      { name: 'memory_update', label: 'Memory Update', desc: '更新记忆', params: { agentId: 'string', memoryId: 'string', content: 'string' } }
    ];

    tools.forEach(tool => {
      api.registerTool({
        name: tool.name,
        label: tool.label,
        description: tool.desc,
        parameters: {
          type: 'object',
          properties: tool.params,
          required: Object.keys(tool.params)
        },
        async execute(_toolCallId: string, params: any) {
          try {
            let result;
            switch (tool.name) {
              case 'memory_list': result = plugin.listMemories(params.agentId, params.limit || 20); break;
              case 'memory_search': result = plugin.searchMemories(params.agentId, params.query); break;
              case 'memory_stats': result = plugin.getStats(params.agentId); break;
              case 'memory_get': result = plugin.getMemory(params.agentId, params.memoryId); break;
              case 'memory_delete': result = { success: plugin.deleteMemory(params.agentId, params.memoryId) }; break;
              case 'memory_clear': result = { deleted: plugin.clearMemories(params.agentId, params.keepCore !== false) }; break;
              case 'memory_update': result = { success: plugin.updateMemory(params.agentId, params.memoryId, params.content) }; break;
            }
            return { content: [{ type: 'text', text: JSON.stringify(result) }] };
          } catch (err: any) {
            return { content: [{ type: 'text', text: 'Error: ' + String(err) }], isError: true };
          }
        }
      });
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
        if (userMsg && shouldRetrieve(userMsg.content || '', DEFAULT_CONFIG.adaptiveRetrieval)) {
          const result = await plugin.recall(agentId, userMsg.content || '');
          if (result.hasMemory) { /* 注入上下文 */ }
        }
      }
    });

    api.onDeactivate(() => plugin.close());
    
    const cfg = api.pluginConfig || {};
    log.info(`[algo-memory] 插件注册完成, 工具数: 7, LLM: ${cfg.llm?.enabled ? '启用' : '关闭'}, 噪声过滤: ${cfg.noiseFilter?.enabled !== false}, Weibull: ${cfg.weibullDecay?.enabled}, Session: ${cfg.sessionMemory?.enabled}`);
  }
};

export default algoMemoryPlugin;
