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
 * - 关键词搜索
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
  dedupThreshold: 0.85
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

// ============= 核心类 =============
class MemoryPlugin {
  private db: Database.Database | null = null;
  private cache: LRUCache<string, any>;
  private cleanupInterval: NodeJS.Timeout | null = null;
  private config: Config;
  private log: any;

  constructor(config: Partial<Config>, log: any = console) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.log = log;
    this.cache = new LRUCache({ max: 100, ttl: 5 * 60 * 1000 });
  }

  async init(stateDir: string): Promise<void> {
    if (!fs.existsSync(stateDir)) {
      fs.mkdirSync(stateDir, { recursive: true });
    }

    const dbPath = path.join(stateDir, 'memories.db');
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('busy_timeout = 5000');

    // 建表 + FTS5 索引
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

    // FTS5 虚拟表 (如果不存在)
    try {
      this.db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
          content, keywords, content=memories, content_rowid=rowid
        );
      `);
    } catch (e) {
      // FTS 可能已存在
    }

    this.log.info('[algo-memory] 数据库初始化完成:', dbPath);
    this.cleanupInterval = setInterval(() => this.cleanup(), 24 * 60 * 60 * 1000);
  }

  async store(agentId: string, messages: any[]): Promise<void> {
    if (!agentId || !messages?.length || !this.db) return;

    for (const msg of messages) {
      if (msg.role !== 'user' || isNoise(msg.content)) continue;

      const content = msg.content.replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const contentHash = hashContent(content);

      // 精确查重
      const existing = this.db.prepare(
        'SELECT id, content FROM memories WHERE agent_id = ? AND content_hash = ?'
      ).get(agentId, contentHash) as { id: string; content: string } | undefined;

      if (existing) {
        this.db.prepare('UPDATE memories SET access_count = access_count + 1, last_accessed = ? WHERE id = ?')
          .run(Date.now(), existing.id);
        this.cache.delete(`recall:${agentId}`);
        continue;
      }

      // 智能去重 (Jaccard)
      if (this.config.smartDedup) {
        const similar = this.db.prepare(
          "SELECT id, content FROM memories WHERE agent_id = ? ORDER BY created_at DESC LIMIT 10"
        ).all(agentId) as { id: string; content: string }[];

        for (const s of similar) {
          const score = jaccardSimilarity(content, s.content);
          if (score >= 0.98) {
            // 几乎相同 - 更新
            this.db.prepare('UPDATE memories SET access_count = access_count + 1, last_accessed = ? WHERE id = ?')
              .run(Date.now(), s.id);
            this.cache.delete(`recall:${agentId}`);
            break;
          } else if (score >= this.config.dedupThreshold) {
            // 部分相似 - 合并内容
            const newContent = s.content + ' ' + content;
            const newKeywords = this.mergeKeywords(s.content, content);
            this.db.prepare('UPDATE memories SET content = ?, keywords = ?, access_count = access_count + 1, last_accessed = ? WHERE id = ?')
              .run(newContent, newKeywords, Date.now(), s.id);
            this.cache.delete(`recall:${agentId}`);
            break;
          }
        }
        continue;
      }

      // 新增记录
      const isCore = isCoreKeyword(content, this.config.coreKeywords);
      const memory = {
        id: generateId(),
        agent_id: agentId,
        content,
        type: 'other',
        layer: isCore ? 'core' : 'general',
        keywords: extractKeywords(content),
        importance: isCore ? 1.0 : 0.5,
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

  private mergeKeywords(content1: string, content2: string): string {
    const kw1 = (extractKeywords(content1) || '').split(',').filter(Boolean);
    const kw2 = (extractKeywords(content2) || '').split(',').filter(Boolean);
    const merged = [...new Set([...kw1, ...kw2])];
    return merged.slice(0, 10).join(',');
  }

  async recall(agentId: string, query: string): Promise<{ hasMemory: boolean; memories: any[] }> {
    const cacheKey = `recall:${agentId}:${query}`;
    if (this.cache.has(cacheKey)) return this.cache.get(cacheKey)!;

    let memories = this.db!.prepare(
      "SELECT * FROM memories WHERE agent_id = ? ORDER BY CASE layer WHEN 'core' THEN 0 ELSE 1 END, importance DESC, access_count DESC LIMIT ?"
    ).all(agentId, this.config.maxResults * 2) as any[];

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
  listMemories(agentId: string, limit: number = 20): any[] {
    return this.db!.prepare('SELECT * FROM memories WHERE agent_id = ? ORDER BY created_at DESC LIMIT ?').all(agentId, limit);
  }

  searchMemories(agentId: string, query: string): any[] {
    const q = `%${query}%`;
    return this.db!.prepare('SELECT * FROM memories WHERE agent_id = ? AND (content LIKE ? OR keywords LIKE ?) ORDER BY importance DESC LIMIT 20').all(agentId, q, q);
  }

  getStats(agentId: string): { total: number; core: number; general: number } {
    const total = this.db!.prepare('SELECT COUNT(*) as count FROM memories WHERE agent_id = ?').get(agentId) as { count: number };
    const core = this.db!.prepare('SELECT COUNT(*) as count FROM memories WHERE agent_id = ? AND layer = "core"').get(agentId) as { count: number };
    const general = this.db!.prepare('SELECT COUNT(*) as count FROM memories WHERE agent_id = ? AND layer = "general"').get(agentId) as { count: number };
    return { total: total.count, core: core.count, general: general.count };
  }

  // 新增: 获取单条记忆
  getMemory(agentId: string, memoryId: string): any | null {
    return this.db!.prepare('SELECT * FROM memories WHERE id = ? AND agent_id = ?').get(memoryId, agentId) || null;
  }

  // 新增: 删除记忆
  deleteMemory(agentId: string, memoryId: string): boolean {
    const result = this.db!.prepare('DELETE FROM memories WHERE id = ? AND agent_id = ?').run(memoryId, agentId);
    this.cache.delete(`recall:${agentId}`);
    return result.changes > 0;
  }

  // 新增: 清空记忆
  clearMemories(agentId: string, keepCore: boolean = true): number {
    let result;
    if (keepCore) {
      result = this.db!.prepare('DELETE FROM memories WHERE agent_id = ? AND layer != "core"').run(agentId);
    } else {
      result = this.db!.prepare('DELETE FROM memories WHERE agent_id = ?').run(agentId);
    }
    this.cache.delete(`recall:${agentId}`);
    return result.changes;
  }

  // 新增: 更新记忆
  updateMemory(agentId: string, memoryId: string, content: string): boolean {
    const safeContent = content.replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const isCore = isCoreKeyword(safeContent, this.config.coreKeywords);
    const result = this.db!.prepare(
      'UPDATE memories SET content = ?, layer = ?, keywords = ?, importance = ?, last_accessed = ? WHERE id = ? AND agent_id = ?'
    ).run(safeContent, isCore ? 'core' : 'general', extractKeywords(safeContent), isCore ? 1.0 : 0.5, Date.now(), memoryId, agentId);
    this.cache.delete(`recall:${agentId}`);
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
  description: '纯算法长期记忆插件 - 0 API / 智能去重 / 时间衰减',
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

    // 工具: memory_get (新增)
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

    // 工具: memory_delete (新增)
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

    // 工具: memory_clear (新增)
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

    // 工具: memory_update (新增)
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
    log.info('[algo-memory] 插件注册完成, 工具数: 7');
  }
};

export default algoMemoryPlugin;
