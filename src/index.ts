/**
 * memory-local-enhanced
 * 纯算法长期记忆插件 - 0 API / 可选 LLM 增强
 */

import { LRUCache } from 'lru-cache';
import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

// ============= 配置 =============
interface Config {
  autoCapture: boolean;
  autoRecall: boolean;
  maxResults: number;
  maxContextChars: number;
  cacheEnabled: boolean;
  cleanupDays: number;
  llm: {
    enabled: boolean;
    provider: string;
    thresholdLength: number;
    apiKey: string;
    model: string;
    baseURL: string;
  };
}

const DEFAULT_CONFIG: Config = {
  autoCapture: true,
  autoRecall: true,
  maxResults: 5,
  maxContextChars: 500,
  cacheEnabled: true,
  cleanupDays: 90,
  llm: {
    enabled: false,
    provider: 'minimax',
    thresholdLength: 100,
    apiKey: '',
    model: 'abab6.5s-chat',
    baseURL: 'https://api.minimax.chat/v1'
  }
};

// ============= 类型 =============
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
}

interface RecallResult {
  hasMemory: boolean;
  memories: Memory[];
  message: string;
}

// ============= 工具函数 =============
function generateId(): string {
  return crypto.randomUUID();
}

function sha256(text: string): string {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function normalizeContent(content: string): string {
  return content
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[。，！？]/g, '.')
    .trim();
}

function estimateTokens(text: string): number {
  const chinese = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
  const english = text.length - chinese;
  return Math.ceil(chinese * 1.5 + english * 0.25);
}

function hashContent(content: string): string {
  return sha256(normalizeContent(content));
}

// 噪声过滤
function isNoise(content: string): boolean {
  const lower = content.toLowerCase().trim();
  const noisePatterns = [
    /^hi|^hello|^hey/i,
    /^好的|^收到|^了解|^ok|^okay/i,
    /^(thanks|thank you)/i,
    /^(好的|收到)/i
  ];
  return noisePatterns.some(p => p.test(lower));
}

// 规则分类 (6类)
function ruleClassify(content: string): Memory['type'] {
  const c = content.toLowerCase();
  
  if (/喜欢|讨厌|最爱|最怕|想要|不爱|prefer|hate|love/i.test(c)) {
    return 'preference';
  }
  if (/^(我叫|name is|this is)/i.test(content.trim())) {
    return 'entity';
  }
  if (/昨天|上次|曾经|明天|去年|下次|last time|yesterday/i.test(c)) {
    return 'event';
  }
  if (/是|在|有|会|can|is|are/i.test(c)) {
    return 'fact';
  }
  if (/比如|例如|such as|i test(c)) {
    return 'case';
  }
  return 'pattern';
}

// 关键词提取
function extractKeywords(content: string): string {
  const words = content
    .toLowerCase()
    .replace(/[^\w\s\u4e00-\u9fa5]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 1);
  
  const stopWords = new Set([
    '的', '是', '在', '有', '和', '了', 'the', 'is', 'are', 'a', 'an', 'and', 'or', 'to', 'of'
  ]);
  
  const filtered = words.filter(w => !stopWords.has(w));
  return JSON.stringify([...new Set(filtered)].slice(0, 10));
}

// ============= 主类 =============
export class MemoryPlugin {
  private db!: Database.Database;
  private config: Config;
  private cache: LRUCache<string, Memory[]>;
  private dbPath: string;

  constructor(config: Partial<Config> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.dbPath = path.join(process.cwd(), '.openclaw', 'memory-enhanced', 'memories.db');
    this.cache = new LRUCache({
      max: 100,
      ttl: 5 * 60 * 1000 // 5分钟
    });
  }

  // 初始化数据库
  async init(): Promise<void> {
    const dir = path.dirname(this.dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(this.dbPath);
    
    // 优化 SQLite
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('busy_timeout = 5000');
    
    // 创建表
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

    // 创建 FTS5 表
    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
        content,
        keywords,
        content=memories,
        content_rowid=rowid
      );
    `);

    console.log('[Memory] 数据库初始化完成:', this.dbPath);
  }

  // 存储记忆
  async store(agentId: string, messages: { role: string; content: string }[]): Promise<void> {
    // 异步处理，不阻塞
    setImmediate(async () => {
      try {
        for (const msg of messages) {
          if (msg.role !== 'user') continue;
          if (isNoise(msg.content)) continue;
          
          await this.processAndStore(agentId, msg.content);
        }
      } catch (error) {
        console.error('[Memory] 存储失败:', error);
      }
    });
  }

  // 处理并存储单条记忆
  private async processAndStore(agentId: string, content: string): Promise<void> {
    // 1. 分类
    let type = ruleClassify(content);
    let keywords = extractKeywords(content);
    
    // 2. LLM 增强 (可选)
    if (this.config.llm.enabled && content.length > this.config.llm.thresholdLength) {
      try {
        const enhanced = await this.llmEnhance(content);
        if (enhanced) {
          type = enhanced.type || type;
          keywords = enhanced.keywords || keywords;
        }
      } catch (error) {
        console.error('[Memory] LLM 增强失败:', error);
      }
    }

    // 3. 哈希去重
    const contentHash = hashContent(content);
    const existing = this.db.prepare(
      'SELECT id FROM memories WHERE agent_id = ? AND content_hash = ?'
    ).get(agentId, contentHash);

    if (existing) {
      // 更新访问时间
      this.db.prepare(
        'UPDATE memories SET access_count = access_count + 1, last_accessed = ? WHERE id = ?'
      ).run(Date.now(), (existing as any).id);
    } else {
      // 写入新记忆
      const memory: Memory = {
        id: generateId(),
        agent_id: agentId,
        content,
        type,
        layer: 'general',
        keywords,
        importance: 0.5,
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

      // FTS 索引
      this.db.prepare('INSERT INTO memories_fts (content, keywords) VALUES (?, ?)')
        .run(content, keywords);
    }

    // 4. 清理缓存
    this.clearCache(agentId);
  }

  // LLM 增强 (可扩展)
  private async llmEnhance(content: string): Promise<{ type?: string; keywords?: string } | null> {
    // TODO: 实现 LLM 调用
    // 可扩展支持 minimax / openai / claude / ollama 等
    return null;
  }

  // 召回记忆
  async recall(agentId: string, query: string): Promise<RecallResult> {
    // 防御检查
    if (!agentId) {
      return { hasMemory: false, memories: [], message: '无效 Agent ID' };
    }

    // 查缓存
    const cacheKey = `recall:${agentId}:${hashContent(query)}`;
    if (this.config.cacheEnabled) {
      const cached = this.cache.get(cacheKey);
      if (cached) {
        return { hasMemory: true, memories: cached, message: '' };
      }
    }

    // 检查是否有记忆
    const count = this.db.prepare(
      'SELECT COUNT(*) as c FROM memories WHERE agent_id = ?'
    ).get(agentId) as { c: number };

    if (count.c === 0) {
      return { hasMemory: false, memories: [], message: '暂无记忆' };
    }

    // 搜索
    const memories = this.db.prepare(`
      SELECT * FROM memories 
      WHERE agent_id = ?
      AND (content LIKE ? OR keywords LIKE ?)
      ORDER BY importance DESC, access_count DESC, last_accessed DESC
      LIMIT ?
    `).all(agentId, `%${query}%`, `%${query}%`, this.config.maxResults) as Memory[];

    // 二次校验
    const validMemories = memories.filter(m => m.agent_id === agentId);

    // Token 限制
    const limited = this.limitByTokens(validMemories, this.config.maxContextChars);

    // 缓存
    if (this.config.cacheEnabled) {
      this.cache.set(cacheKey, limited);
    }

    return { hasMemory: true, memories: limited, message: '' };
  }

  // Token 限制
  private limitByTokens(memories: Memory[], maxTokens: number): Memory[] {
    let totalTokens = 0;
    const result: Memory[] = [];

    for (const m of memories) {
      const tokens = estimateTokens(m.content);
      if (totalTokens + tokens > maxTokens) break;
      result.push(m);
      totalTokens += tokens;
    }

    return result;
  }

  // 清理缓存
  private clearCache(agentId: string): void {
    // 简单清理: 重置缓存
    if (this.config.cacheEnabled) {
      this.cache.clear();
    }
  }

  // 删除 Agent 记忆
  async deleteAgent(agentId: string): Promise<void> {
    // 删除记忆
    this.db.prepare('DELETE FROM memories WHERE agent_id = ?').run(agentId);
    
    // 清理缓存
    this.clearCache(agentId);
    
    console.log(`[Memory] 已删除 Agent ${agentId} 的所有记忆`);
  }

  // 关闭
  close(): void {
    if (this.db) {
      this.db.close();
    }
  }
}

// ============= OpenClaw 钩子 =============
let memoryPlugin: MemoryPlugin;

export async function onload(context: any): Promise<void> {
  const config = context.config?.plugins?.entries?.['memory-local-enhanced']?.config || {};
  
  memoryPlugin = new MemoryPlugin(config);
  await memoryPlugin.init();

  // 注册钩子
  context.hooks.on('agent_end', async (agent: any, messages: any[]) => {
    const agentId = typeof agent === 'object' ? agent.id : agent;
    if (config.autoCapture) {
      await memoryPlugin.store(agentId, messages);
    }
  });

  context.hooks.on('before_agent_start', async (agent: any, context: any) => {
    const agentId = typeof agent === 'object' ? agent.id : agent;
    if (config.autoRecall) {
      const result = await memoryPlugin.recall(agentId, context.input || '');
      if (result.hasMemory && result.memories.length > 0) {
        const memoryText = result.memories
          .map(m => `• ${m.content}`)
          .join('\n');
        
        context.systemPrompt = context.systemPrompt || '';
        context.systemPrompt += `\n\n<relevant-memories>\n${memoryText}\n</relevant-memories>`;
      }
    }
  });

  context.hooks.on('agent:delete', async (agentId: string) => {
    await memoryPlugin.deleteAgent(agentId);
  });

  console.log('[Memory] memory-local-enhanced 插件加载完成');
}

export async function onunload(): Promise<void> {
  if (memoryPlugin) {
    memoryPlugin.close();
  }
}
