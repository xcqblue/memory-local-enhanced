/**
 * algo-memory
 * 纯算法长期记忆插件 - 0 API / 可选 LLM 增强
 * 遵循官方 OpenClaw register(api) 规范
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
  recencyHalfLife: 180
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

      const existing = this.db.prepare(
        'SELECT id FROM memories WHERE agent_id = ? AND content_hash = ?'
      ).get(AgentId, contentHash) as { id: string } | undefined;

      if (existing) {
        this.db.prepare('UPDATE memories SET access_count = access_count + 1, last_accessed = ? WHERE id = ?')
          .run(Date.now(), existing.id);
        this.cache.delete(`recall:${AgentId}`);
        continue;
      }

      const isCore = isCoreKeyword(content, this.config.coreKeywords);
      const memory = {
        id: generateId(),
        agent_id: AgentId,
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
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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

  close(): void {
    if (this.cleanupInterval) { clearInterval(this.cleanupInterval); this.cleanupInterval = null; }
    if (this.db) { this.db.close(); this.db = null; }
    this.log.info('[algo-memory] 插件关闭');
  }
}

// ============= 插件定义 (官方格式) =============
const algoMemoryPlugin = {
  id: 'algo-memory',
  name: 'algo-memory',
  description: '纯算法长期记忆插件 - 0 API / 可选 LLM 增强',
  kind: 'memory' as const,

  register(api: any) {
    const log = api.logger || console;
    const plugin = new MemoryPlugin(api.pluginConfig || {}, log);

    const stateDir = api.getStateDir?.() || path.join(process.env.HOME || '/home/x', '.openclaw', 'workspace', 'algo-memory');
    plugin.init(stateDir);

    // 注册工具 - memory_list
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

    // 注册工具 - memory_search
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

    // 注册工具 - memory_stats
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

    // 对话钩子
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

    // 关闭钩子
    api.onDeactivate(() => plugin.close());

    log.info('[algo-memory] 插件注册完成');
  }
};

export default algoMemoryPlugin;
