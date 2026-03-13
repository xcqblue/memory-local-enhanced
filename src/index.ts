/**
 * algo-memory
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
  cleanupDelayHours: number;
  coreKeywords: string[];
  logLevel: 'error' | 'warn' | 'info' | 'debug';
  recencyDecay: boolean;
  recencyHalfLife: number;
  publicMemory: boolean;
  smartDedup: boolean;
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
  cleanupDays: 180,
  cleanupDelayHours: 1,
  coreKeywords: [
    '记住', '牢记', '重要', '不要忘记', '记住它', 
    '这是关键', '永久保留', '一直记住', '别忘了',
    'remember', 'important', 'never forget', 'always remember',
    '关键', '核心', '必须记住', '一定要记住'
  ],
  logLevel: 'info',
  recencyDecay: true,
  recencyHalfLife: 90,
  publicMemory: false,
  smartDedup: true,
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
  owner?: string;
  source?: string;
}

interface RecallResult {
  hasMemory: boolean;
  memories: Memory[];
  message: string;
}

// ============= 工具函数 =============
const GITHUB_REPO = 'xcqblue/algo-memory';
const GITHUB_RAW_BASE = 'https://raw.githubusercontent.com/xcqblue/algo-memory/main';

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
// 智能去重判断结果
type DedupResult = 'DUPLICATE' | 'UPDATE' | 'NEW';

// Jaccard 相似度 (0-1, 越高越相似)
function jaccardSimilarity(text1: string, text2: string): number {
  const set1 = new Set(text1.toLowerCase().split(''));
  const set2 = new Set(text2.toLowerCase().split(''));
  const intersection = new Set([...set1].filter(x => set2.has(x)));
  const union = new Set([...set1, ...set2]);
  return union.size === 0 ? 0 : intersection.size / union.size;
}

function isNoise(content: string): boolean {
  const lower = content.toLowerCase().trim();
  const noisePatterns = [
    /^hi|^hello|^hey/i,
    /^好的|^收到|^了解|^ok|^okay|^好滴|^明白了/i,
    /^(thanks|thank you)/i,
    /^(好的|收到|了解|明白)/i,
    /^[\s]*$/,
    /^[\.。!?！?]+$/
  ];
  return noisePatterns.some(p => p.test(lower));
}

// 智能去重判断结果
type DedupResult = 'DUPLICATE' | 'UPDATE' | 'NEW';

// Jaccard 相似度 (0-1, 越高越相似)
function jaccardSimilarity(text1: string, text2: string): number {
  const set1 = new Set(text1.toLowerCase().split(''));
  const set2 = new Set(text2.toLowerCase().split(''));
  const intersection = new Set([...set1].filter(x => set2.has(x)));
  const union = new Set([...set1, ...set2]);
  return union.size === 0 ? 0 : intersection.size / union.size;
}

// 时间衰减函数
function calculateRecencyScore(lastAccessed: number, halfLifeDays: number = 90): number {
  const now = Date.now();
  const daysPassed = (now - lastAccessed) / (1000 * 60 * 60 * 24);
  return 0.3 + 0.7 * Math.pow(0.5, daysPassed / halfLifeDays);
}

// Jaccard 相似度 (0-1, 越高越相似)
function jaccardSimilarity(text1: string, text2: string): number {
  const set1 = new Set(text1.toLowerCase().split(''));
  const set2 = new Set(text2.toLowerCase().split(''));
  const intersection = new Set([...set1].filter(x => set2.has(x)));
  const union = new Set([...set1, ...set2]);
  return union.size === 0 ? 0 : intersection.size / union.size;
}

// 时间衰减函数
function calculateRecencyScore(lastAccessed: number, halfLifeDays: number = 14): number {
  const now = Date.now();
  const daysPassed = (now - lastAccessed) / (1000 * 60 * 60 * 24);
  return 0.3 + 0.7 * Math.pow(0.5, daysPassed / halfLifeDays);
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
  if (/比如|例如|such as/i.test(c)) {
    return 'case';
  }
  return 'pattern';
}

// 自动判断 core 记忆 (根据关键词)
function isCoreKeyword(content: string): boolean {
  const lower = content.toLowerCase();
  const coreKeywords = [
    '记住', '牢记', '重要', '不要忘记', '记住它', 
    '这是关键', '永久保留', '一直记住', '别忘了',
    'remember', 'important', 'never forget', 'always remember',
    '关键', '核心', '必须记住', '一定要记住'
  ];
  return coreKeywords.some(kw => lower.includes(kw));
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
  private cleanupTimer: NodeJS.Timeout | null = null;

  constructor(config: Partial<Config> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.dbPath = path.join(process.cwd(), '.openclaw', 'memory-enhanced', 'memories.db');
    this.cache = new LRUCache({
      max: 100,
      ttl: 5 * 60 * 1000 // 5分钟
    });
  }

  // 日志方法
  private log(level: 'error' | 'warn' | 'info' | 'debug', message: string, ...args: any[]): void {
    const logLevel = this.config.logLevel || 'info';
    const levels = { error: 0, warn: 1, info: 2, debug: 3 };
    if (levels[level] <= levels[logLevel]) {
      console.log(`[Memory] ${message}`, ...args);
    }
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
    
    // 创建表 (SQLite 会自动生成 rowid)
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

    // 创建 FTS5 表 (外部内容方式)
    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
        id UNINDEXED,
        content,
        keywords
      );
    `);

    // 创建过期清理表记录
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memory_metadata (
        key TEXT PRIMARY KEY,
        value TEXT
      );
    `);

    console.log('[Memory] 数据库初始化完成:', this.dbPath);

    // 启动定时清理任务 (延迟启动 + 每天检查一次, 防重)
    const delayMs = (this.config.cleanupDelayHours || 1) * 60 * 60 * 1000;
    setTimeout(() => {
      this.cleanupExpired().catch(err => this.log('error', '定时清理失败:', err));
      if (!this.cleanupTimer) {
        this.cleanupTimer = setInterval(() => {
          this.cleanupExpired().catch(err => this.log('error', '定时清理失败:', err));
        }, 24 * 60 * 60 * 1000);
      }
    }, delayMs);
  }

  // 存储记忆
  async store(agentId: string, messages: { role: string; content: string }[]): Promise<void> {
    // 防御检查
    if (!agentId || !messages || !messages.length) {
      return;
    }
    
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

  // LLM 增强 (支持多种提供商)
  private async llmEnhance(content: string): Promise<{ type?: string; keywords?: string } | null> {
    const { provider, apiKey, model, baseURL } = this.config.llm;
    
    if (!apiKey) {
      console.warn('[Memory] LLM API Key 未配置');
      return null;
    }

    const prompt = `分析以下内容，提取：
1. 类型 (preference/fact/event/entity/case/pattern)
2. 关键词 (最多10个，用逗号分隔)

只返回 JSON 格式：{"type": "类型", "keywords": "关键词"}

内容：${(content.slice(0, 500)).replace(/[{}"\n]/g, ' ')}`;

    try {
      let response: Response;
      let url = '';
      let headers: Record<string, string> = { 'Content-Type': 'application/json' };
      let body: any = {};

      if (provider === 'ollama') {
        // Ollama 本地模型
        url = `${baseURL}/api/generate`;
        body = { model: model || 'llama2', prompt, stream: false };
      } else if (provider === 'openai' || provider === 'claude' || provider === 'deepseek') {
        // OpenAI / Claude / DeepSeek 兼容格式
        url = `${baseURL}/chat/completions`;
        headers['Authorization'] = `Bearer ${apiKey}`;
        body = {
          model: model,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.3
        };
      } else if (provider === 'minimax') {
        // MiniMax 格式 (支持 v1 和 v2)
        const endpoint = baseURL.includes('/v2') ? '/text/chatcompletion_v2' : '/text/chatcompletion_pro';
        url = `${baseURL}${endpoint}`;
        headers['Authorization'] = `Bearer ${apiKey}`;
        body = {
          model: model,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.3,
          max_tokens: 1024
        };
      } else {
        console.warn(`[Memory] 不支持的 LLM provider: ${provider}`);
        return null;
      }

      response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10000) // 10秒超时
      });

      if (!response.ok) {
        throw new Error(`LLM API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      let text = '';
      
      if (provider === 'ollama') {
        text = data.response;
      } else if (provider === 'minimax') {
        // MiniMax 响应格式
        text = data.choices?.[0]?.message?.content || data.choices?.[0]?.message?.reply || '';
      } else {
        text = data.choices?.[0]?.message?.content || '';
      }

      // 解析 JSON 响应
      const match = text.match(/\{[\s\S]*\}/);
      if (match) {
        const result = JSON.parse(match[0]);
        // 校验 type 合法性，如果非法则返回 undefined
        const validTypes = ['preference', 'fact', 'event', 'entity', 'case', 'pattern', 'other'];
        const type = validTypes.includes(result.type) ? result.type : undefined;
        
        // 处理关键词，支持字符串或数组
        let keywords: string | undefined;
        if (result.keywords) {
          const kwArray = Array.isArray(result.keywords) 
            ? result.keywords 
            : result.keywords.split(',');
          keywords = JSON.stringify(kwArray.map((k: string) => k.trim()).filter(Boolean).slice(0, 10));
        }
        
        return { type, keywords };
      }
    } catch (error) {
      console.error('[Memory] LLM 增强失败:', error);
    }
    
    return null;
  }

  // 召回记忆 (支持两层分层)
  async recall(agentId: string, query: string): Promise<RecallResult> {
    // 防御检查
    if (!agentId) {
      return { hasMemory: false, memories: [], message: '无效 Agent ID' };
    }

    // 查缓存 (限制 query 长度避免 key 过长)
    // 注意: 空 query 使用特殊 key 避免冲突
    const queryKey = query.trim() ? hashContent(query.slice(0, 100)) : 'empty';
    const cacheKey = `recall:${agentId}:${queryKey}`;
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

    // 优先召回 core 记忆，然后是 general 记忆
    let memories: Memory[];
    
    if (query.trim()) {
      // 有查询词：搜索匹配的记忆 (支持公共记忆)
      const searchCondition = this.config.publicMemory 
        ? '(agent_id = ? OR owner = "public") AND (content LIKE ? OR keywords LIKE ?)'
        : 'agent_id = ? AND (content LIKE ? OR keywords LIKE ?)';
      
      memories = this.db.prepare(`
        SELECT * FROM memories 
        WHERE ${searchCondition}
        ORDER BY 
          CASE layer WHEN 'core' THEN 0 ELSE 1 END,
          importance DESC, access_count DESC, last_accessed DESC
        LIMIT ?
      `).all(agentId, `%${query}%`, `%${query}%`, this.config.maxResults * 2) as Memory[];
    } else {
      // 无查询词：返回最近的和重要的 (支持公共记忆)
      const searchCondition = this.config.publicMemory 
        ? 'agent_id = ? OR owner = "public"'
        : 'agent_id = ?';
      
      memories = this.db.prepare(`
        SELECT * FROM memories 
        WHERE ${searchCondition}
        ORDER BY 
          CASE layer WHEN 'core' THEN 0 ELSE 1 END,
          importance DESC, access_count DESC, last_accessed DESC
        LIMIT ?
      `).all(agentId, this.config.maxResults * 2) as Memory[];
    }

    // 二次校验
    let validMemories = memories.filter(m => 
      m.agent_id === agentId || m.owner === 'public'
    );

    // 时间衰减计算 (如果开启)
    if (this.config.recencyDecay) {
      validMemories = validMemories.map(m => ({
        ...m,
        _score: (m.layer === 'core' ? 1.5 : 1.0) * m.importance * m.access_count * calculateRecencyScore(m.last_accessed, this.config.recencyHalfLife)
      })).sort((a, b) => (b as any)._score - (a as any)._score)
        .map(({ _score, ...m }) => m);
    }

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

  // 清理指定 Agent 的缓存
  private invalidateCache(agentId: string): void {
    if (this.config.cacheEnabled && this.cache) {
      // 遍历缓存找到匹配的 key 并删除
      // 注意: LRUCache 不支持直接删除单个 key，需要重建
      const newCache = new LRUCache<string, Memory[]>({
        max: 100,
        ttl: 5 * 60 * 1000
      });
      
      for (const key of this.cache.keys()) {
        if (!key.includes(`:${agentId}:`)) {
          const value = this.cache.get(key);
          if (value) newCache.set(key, value);
        }
      }
      
      // 替换缓存
      (this as any).cache = newCache;
    }
  }

  // 删除 Agent 记忆 (同时删除 FTS 索引)
  async deleteAgent(agentId: string): Promise<number> {
    // 防御检查
    if (!agentId) {
      console.warn('[Memory] 无效 Agent ID');
      return 0;
    }
    
    // 使用事务保证一致性
    const transaction = this.db.transaction(() => {
      // 先获取该 Agent 的所有 id
      const rows = this.db.prepare('SELECT id FROM memories WHERE agent_id = ?').all(agentId) as { id: string }[];
      
      // 删除 FTS 记录
      for (const row of rows) {
        this.db.prepare('DELETE FROM memories_fts WHERE id = ?').run(row.id);
      }
      
      // 删除记忆
      this.db.prepare('DELETE FROM memories WHERE agent_id = ?').run(agentId);
      
      return rows.length;
    });
    
    const deletedCount = transaction();
    
    // 清理缓存
    this.invalidateCache(agentId);
    
    console.log(`[Memory] 已删除 Agent ${agentId} 的 ${deletedCount} 条记忆`);
    return deletedCount;
  }

  // 清理过期记忆
  async cleanupExpired(): Promise<number> {
    const cutoffTime = Date.now() - this.config.cleanupDays * 24 * 60 * 60 * 1000;
    
    // 获取要删除的记忆
    const rows = this.db.prepare(
      'SELECT id FROM memories WHERE last_accessed < ? AND layer = "general"'
    ).all(cutoffTime) as { id: string }[];
    
    // 删除 FTS 记录
    for (const row of rows) {
      this.db.prepare('DELETE FROM memories_fts WHERE id = ?').run(row.id);
    }
    
    // 删除记忆
    const result = this.db.prepare(
      'DELETE FROM memories WHERE last_accessed < ? AND layer = "general"'
    ).run(cutoffTime);
    
    console.log(`[Memory] 清理了 ${result.changes} 条过期记忆`);
    return result.changes;
  }

  // 从 OpenClaw 内置记忆导入
  async importFromOpenClaw(agentId?: string): Promise<{ stored: number; skipped: number; merged: number; errors: number }> {
    const openclawPath = path.join(process.cwd(), '.openclaw', 'agents');
    const stats = { stored: 0, skipped: 0, merged: 0, errors: 0 };
    
    if (!fs.existsSync(openclawPath)) {
      console.log('[Memory] OpenClaw agents 目录不存在');
      return stats;
    }

    // 获取所有 agent 目录
    const agentDirs = fs.readdirSync(openclawPath).filter(d => {
      const agentPath = path.join(openclawPath, d);
      return fs.statSync(agentPath).isDirectory() && d !== 'templates';
    });

    // 收集所有消息
    const allMessages: { agentId: string; role: string; content: string }[] = [];

    for (const dir of agentDirs) {
      // 如果指定了 agentId，跳过其他
      if (agentId && dir !== agentId) continue;

      const sessionsPath = path.join(openclawPath, dir, 'sessions');
      if (!fs.existsSync(sessionsPath)) continue;

      // 获取所有 jsonl 文件
      const files = fs.readdirSync(sessionsPath).filter(f => f.endsWith('.jsonl'));

      for (const file of files) {
        try {
          const filePath = path.join(sessionsPath, file);
          const content = fs.readFileSync(filePath, 'utf-8');
          const lines = content.trim().split('\n');

          for (const line of lines) {
          try {
            const obj = JSON.parse(line);
            
            // 处理不同类型的消息
            let role = '';
            let content = '';
            
            if (obj.type === 'message' && obj.message) {
              // 新格式: { type: 'message', message: { role, content } }
              role = obj.message.role;
              const contentArray = obj.message.content;
              if (Array.isArray(contentArray)) {
                // content 是数组，取所有 text 类型
                content = contentArray.map((c: any) => c.text || c.thinking || '').join('');
              } else {
                content = contentArray || '';
              }
            } else if (obj.role && obj.content) {
              // 旧格式: { role, content }
              role = obj.role;
              content = typeof obj.content === 'string' ? obj.content : '';
            }
            
            // 只提取 user 和 assistant 消息
            if (role === 'user' || role === 'assistant') {
              if (content && content.trim().length > 0 && !isNoise(content)) {
                allMessages.push({ agentId: dir, role, content: content.trim() });
              } else {
                stats.skipped++;
              }
            }
          } catch (e) {
            stats.errors++;
          }
        }
        } catch (e) {
          stats.errors++;
        }
      }
    }

    // 批量存储 (不等待每条，收集后一起处理)
    const contents = new Map<string, string[]>(); // agentId -> contents
    
    for (const msg of allMessages) {
      if (!contents.has(msg.agentId)) {
        contents.set(msg.agentId, []);
      }
      contents.get(msg.agentId)!.push(msg.content);
    }

    // 逐条存储 (store 内部会处理去重)
    for (const [agentId, msgs] of contents) {
      for (const content of msgs) {
        await this.store(agentId, [{ role: 'user', content }]);
        stats.stored++;
      }
    }

    console.log(`[Memory] 导入完成: 新增=${stats.stored}, 跳过=${stats.skipped}, 合并=${stats.merged}, 错误=${stats.errors}`);
    return stats;
  }

  // 标记为核心记忆 (core layer)
  async markAsCore(memoryId: string): Promise<boolean> {
    if (!memoryId) return false;
    
    const memory = this.db.prepare('SELECT agent_id FROM memories WHERE id = ?').get(memoryId) as { agent_id: string } | undefined;
    if (!memory || !memory.agent_id) return false;
    
    this.db.prepare('UPDATE memories SET layer = "core", importance = 1.0 WHERE id = ?').run(memoryId);
    this.invalidateCache(memory.agent_id);
    return true;
  }

  // 升级为 core 记忆 (手动调用)
  async promoteToCore(agentId: string, memoryId: string): Promise<boolean> {
    const memory = this.db.prepare('SELECT * FROM memories WHERE id = ? AND agent_id = ?')
      .get(memoryId, agentId) as Memory | undefined;
    
    if (memory) {
      this.db.prepare('UPDATE memories SET layer = "core", importance = 1.0 WHERE id = ?').run(memoryId);
      this.invalidateCache(agentId);
      console.log(`[Memory] 记忆 ${memoryId} 已手动升级为 core`);
      return true;
    }
    return false;
  }

  // 获取统计信息
  getStats(agentId?: string): { total: number; byType: Record<string, number>; byLayer: Record<string, number> } {
    const whereClause = agentId ? 'WHERE agent_id = ?' : '';
    const params = agentId ? [agentId] : [];
    
    const total = this.db.prepare(`SELECT COUNT(*) as c FROM memories ${whereClause}`)
      .get(...params) as { c: number };
    
    const byType = this.db.prepare(`
      SELECT type, COUNT(*) as c FROM memories ${whereClause} GROUP BY type
    `).all(...params) as { type: string; c: number }[];
    
    const byLayer = this.db.prepare(`
      SELECT layer, COUNT(*) as c FROM memories ${whereClause} GROUP BY layer
    `).all(...params) as { layer: string; c: number }[];
    
    return {
      total: total.c,
      byType: byType.reduce((acc, row) => ({ ...acc, [row.type]: row.c }), {}),
      byLayer: byLayer.reduce((acc, row) => ({ ...acc, [row.layer]: row.c }), {})
    };
  }

  // 列出记忆
  listMemories(agentId: string, limit = 20, offset = 0): Memory[] {
    if (!agentId) return [];
    return this.db.prepare(`
      SELECT * FROM memories WHERE agent_id = ? 
      ORDER BY last_accessed DESC LIMIT ? OFFSET ?
    `).all(agentId, limit, offset) as Memory[];
  }

  // 获取单条记忆详情
  getMemoryDetail(memoryId: string): Memory | null {
    if (!memoryId) return null;
    const memory = this.db.prepare('SELECT * FROM memories WHERE id = ?').get(memoryId) as Memory | undefined;
    return memory || null;
  }

  // 删除单条记忆
  deleteMemory(memoryId: string): boolean {
    if (!memoryId) return false;
    
    // 先查询获取 agent_id 用于清理缓存
    const memory = this.db.prepare('SELECT agent_id FROM memories WHERE id = ?').get(memoryId) as { agent_id: string } | undefined;
    if (!memory) return false;
    
    // 删除 FTS 索引
    this.db.prepare('DELETE FROM memories_fts WHERE id = ?').run(memoryId);
    
    // 删除记忆
    const result = this.db.prepare('DELETE FROM memories WHERE id = ?').run(memoryId);
    
    if (result.changes > 0) {
      // 清理缓存
      this.invalidateCache(memory.agent_id);
      console.log(`[Memory] 已删除记忆 ${memoryId}`);
      return true;
    }
    return false;
  }

  // 更新记忆内容
  updateMemory(memoryId: string, newContent: string): boolean {
    if (!memoryId || !newContent) return false;
    
    const memory = this.db.prepare('SELECT agent_id FROM memories WHERE id = ?').get(memoryId) as { agent_id: string } | undefined;
    if (!memory) return false;
    
    const safeContent = newContent.replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const safeKeywords = extractKeywords(safeContent);
    const contentHash = hashContent(safeContent);
    
    this.db.prepare(`
      UPDATE memories 
      SET content = ?, keywords = ?, content_hash = ?, last_accessed = ?
      WHERE id = ?
    `).run(safeContent, safeKeywords, contentHash, Date.now(), memoryId);
    
    // 更新 FTS 索引
    this.db.prepare('DELETE FROM memories_fts WHERE id = ?').run(memoryId);
    this.db.prepare('INSERT INTO memories_fts (id, content, keywords) VALUES (?, ?, ?)')
      .run(memoryId, safeContent, safeKeywords);
    
    this.invalidateCache(memory.agent_id);
    return true;
  }

  // 搜索记忆 (FTS5)
  searchMemories(agentId: string, query: string, limit = 10): Memory[] {
    if (!agentId) return [];
    return this.db.prepare(`
      SELECT m.* FROM memories m
      WHERE m.agent_id = ? AND (
        m.content LIKE ? OR m.keywords LIKE ?
      )
      ORDER BY 
        CASE m.layer WHEN 'core' THEN 0 ELSE 1 END,
        m.importance DESC, m.access_count DESC
      LIMIT ?
    `).all(agentId, `%${query}%`, `%${query}%`, limit) as Memory[];
  }

  // 设置记忆
  async setCoreMemory(agentId: string, content: string, type: Memory['type'] = 'fact'): Promise<Memory | null> {
    if (!agentId || !content) return null;
    
    // 转义内容防止注入
    const safeContent = content.replace(/</g, '&lt;').replace(/>/g, '&gt;');
    
    const memory: Memory = {
      id: generateId(),
      agent_id: agentId,
      content,
      type,
      layer: 'core',
      keywords: extractKeywords(content),
      importance: 1.0,
      access_count: 1,
      created_at: Date.now(),
      last_accessed: Date.now(),
      content_hash: hashContent(content)
    };

    const insertMemory = this.db.prepare(`
      INSERT INTO memories (id, agent_id, content, type, layer, keywords, importance, access_count, created_at, last_accessed, content_hash)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const transaction = this.db.transaction(() => {
      insertMemory.run(
        memory.id, memory.agent_id, safeContent, memory.type, memory.layer,
        memory.keywords, memory.importance, memory.access_count,
        memory.created_at, memory.last_accessed, memory.content_hash
      );
      
      // 插入 FTS 索引
      this.db.prepare('INSERT INTO memories_fts (id, content, keywords) VALUES (?, ?, ?)')
        .run(memory.id, safeContent, memory.keywords);
    });
    
    transaction();
    
    return { ...memory, content: safeContent };
  }

  // 写入公共记忆
  async writePublicMemory(content: string, type: Memory['type'] = 'fact'): Promise<Memory | null> {
    if (!content) return null;
    if (!this.config.publicMemory) {
      this.log('warn', '公共记忆功能未启用');
      return null;
    }
    
    const safeContent = content.replace(/</g, '&lt;').replace(/>/g, '&gt;');
    
    const memory: Memory = {
      id: generateId(),
      agent_id: 'public',
      content: safeContent,
      type,
      layer: 'general',
      keywords: extractKeywords(safeContent),
      importance: 0.5,
      access_count: 1,
      created_at: Date.now(),
      last_accessed: Date.now(),
      content_hash: hashContent(safeContent),
      owner: 'public',
      source: 'dialog'
    };

    const insertMemory = this.db.prepare(`
      INSERT INTO memories (id, agent_id, content, type, layer, keywords, importance, access_count, created_at, last_accessed, content_hash, owner, source)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const transaction = this.db.transaction(() => {
      insertMemory.run(
        memory.id, memory.agent_id, memory.content, memory.type, memory.layer,
        memory.keywords, memory.importance, memory.access_count,
        memory.created_at, memory.last_accessed, memory.content_hash,
        memory.owner, memory.source
      );
      
      this.db.prepare('INSERT INTO memories_fts (id, content, keywords) VALUES (?, ?, ?)')
        .run(memory.id, safeContent, memory.keywords);
    });
    
    transaction();
    
    this.log('info', `写入公共记忆: ${memory.id}`);
    return memory;
  }

  // 智能去重 (Jaccard + 可选 LLM)
  async smartDedup(agentId: string, content: string): Promise<{ result: DedupResult; existingId?: string; merged?: string }> {
    if (!this.config.smartDedup) {
      return { result: 'NEW' };
    }

    // 1. Jaccard 快速过滤
    const similar = this.db.prepare(`
      SELECT * FROM memories 
      WHERE agent_id = ? 
      ORDER BY last_accessed DESC 
      LIMIT 20
    `).all(agentId) as Memory[];

    if (similar.length === 0) {
      return { result: 'NEW' };
    }

    const JACCARD_THRESHOLD = 0.85;
    let existingId: string | undefined;

    for (const mem of similar) {
      const similarity = jaccardSimilarity(content, mem.content);
      
      if (similarity >= 0.98) {
        return { result: 'DUPLICATE', existingId: mem.id };
      } else if (similarity >= JACCARD_THRESHOLD) {
        existingId = mem.id;
      }
    }

    if (existingId) {
      return { result: 'UPDATE', existingId };
    }

    // 2. LLM 精调 (如果 Jaccard 没找到但很接近)
    const nearThreshold = similar.find(m => jaccardSimilarity(content, m.content) >= 0.6);
    
    if (!nearThreshold || !this.config.llm.enabled || !this.config.llm.apiKey) {
      return { result: 'NEW' };
    }

    // 调用 LLM
    const prompt = `判断以下新内容与已有记忆的关系：
已有记忆: ${nearThreshold.content}
新内容: ${content}
判断结果 (只返回 JSON): {"result": "DUPLICATE|UPDATE|NEW", "reason": "理由"}`;

    try {
      const { provider, apiKey, model, baseURL } = this.config.llm;
      let response: Response;
      
      if (provider === 'minimax') {
        const endpoint = baseURL.includes('/v2') ? '/text/chatcompletion_v2' : '/text/chatcompletion_pro';
        response = await fetch(`${baseURL}${endpoint}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
          body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }], temperature: 0.3 })
        });
      } else {
        response = await fetch(`${baseURL}/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
          body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }], temperature: 0.3 })
        });
      }

      const data = await response.json();
      const text = data.choices?.[0]?.message?.content || '';
      const match = text.match(/\{[\s\S]*\}/);
      
      if (match) {
        const parsed = JSON.parse(match[0]);
        const result = parsed.result?.toUpperCase();
        if (result === 'DUPLICATE' || result === 'UPDATE') {
          return { result, existingId: nearThreshold.id };
        }
      }
    } catch (error) {
      this.log('error', '智能去重失败:', error);
    }

    return { result: 'NEW' };
  }

  // 关闭
  close(): void {
    // 清除定时任务
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    if (this.db) {
      this.db.close();
    }
  }

  // 获取当前版本号 (日期格式: YYYYMMDD + 可选后缀)
  private getCurrentVersion(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const baseVersion = `${year}${month}${day}`;
    
    // 检查是否有当天多次更新的后缀文件
    const versionFile = path.join(process.cwd(), '.openclaw', 'memory-enhanced', 'version.json');
    try {
      if (fs.existsSync(versionFile)) {
        const versionData = JSON.parse(fs.readFileSync(versionFile, 'utf8'));
        if (versionData.baseVersion === baseVersion && versionData.suffix) {
          return `${baseVersion}${versionData.suffix}`;
        }
      }
    } catch (e) {
      // 忽略错误
    }
    
    return baseVersion;
  }

  // 保存版本号 (支持同一天多次更新)
  private saveVersion(suffix?: string): void {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const baseVersion = `${year}${month}${day}`;
    
    const versionFile = path.join(process.cwd(), '.openclaw', 'memory-enhanced', 'version.json');
    const dir = path.dirname(versionFile);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    const versionData = {
      baseVersion,
      suffix: suffix || '',
      updatedAt: Date.now()
    };
    
    fs.writeFileSync(versionFile, JSON.stringify(versionData, null, 2));
  }

  // 增加版本后缀 (当天多次更新时)
  bumpVersion(): void {
    const versionFile = path.join(process.cwd(), '.openclaw', 'memory-enhanced', 'version.json');
    try {
      if (fs.existsSync(versionFile)) {
        const versionData = JSON.parse(fs.readFileSync(versionFile, 'utf8'));
        const currentSuffix = versionData.suffix || '';
        
        if (currentSuffix === '') {
          versionData.suffix = 'a';
        } else {
          // 生成下一个后缀字母
          const lastChar = currentSuffix.charCodeAt(currentSuffix.length - 1);
          if (lastChar >= 97 && lastChar < 122) { // a-z
            versionData.suffix = currentSuffix.slice(0, -1) + String.fromCharCode(lastChar + 1);
          } else {
            versionData.suffix = currentSuffix + 'a';
          }
        }
        
        fs.writeFileSync(versionFile, JSON.stringify(versionData, null, 2));
        console.log(`[Memory] 版本号已更新: ${versionData.baseVersion}${versionData.suffix}`);
      }
    } catch (e) {
      console.error('[Memory] 更新版本失败:', e);
    }
  }

  // 检查 GitHub 更新 (通过版本号文件)
  async checkUpdate(): Promise<{ hasUpdate: boolean; latestVersion: string; currentVersion: string }> {
    try {
      const currentVersion = this.getCurrentVersion();
      
      // 获取 GitHub 上的版本号文件
      const response = await fetch(`${GITHUB_RAW_BASE}/VERSION.txt`);
      if (!response.ok) {
        return { hasUpdate: false, latestVersion: 'unknown', currentVersion };
      }
      
      const latestVersion = (await response.text()).trim();
      
      return {
        hasUpdate: latestVersion !== currentVersion,
        latestVersion,
        currentVersion
      };
    } catch (error) {
      console.error('[Memory] 检查更新失败:', error);
      return { hasUpdate: false, latestVersion: 'unknown', currentVersion: 'unknown' };
    }
  }

  // 从 GitHub 拉取更新
  async updateFromGitHub(): Promise<{ success: boolean; message: string }> {
    try {
      console.log('[Memory] 正在从 GitHub 拉取更新...');
      
      // 获取最新源码
      const response = await fetch(`${GITHUB_RAW_BASE}/src/index.ts`);
      if (!response.ok) {
        return { success: false, message: `拉取失败: ${response.status}` };
      }
      
      const newCode = await response.text();
      
      // 写入文件
      const updatePath = path.join(process.cwd(), '.openclaw', 'plugins', 'algo-memory', 'src', 'index.ts');
      const dir = path.dirname(updatePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      
      fs.writeFileSync(updatePath, newCode, 'utf8');
      
      // 保存版本号
      this.saveVersion();
      
      console.log('[Memory] 更新完成，请重启 OpenClaw');
      
      return { success: true, message: '更新完成，请重启 OpenClaw' };
    } catch (error) {
      console.error('[Memory] 更新失败:', error);
      return { success: false, message: `更新失败: ${error}` };
    }
  }

  // 从本地文件更新
  async updateFromFile(filePath: string): Promise<{ success: boolean; message: string }> {
    try {
      if (!filePath) {
        return { success: false, message: '请提供文件路径' };
      }
      
      if (!fs.existsSync(filePath)) {
        return { success: false, message: `文件不存在: ${filePath}` };
      }
      
      const newCode = fs.readFileSync(filePath, 'utf8');
      
      // 写入插件目录
      const updatePath = path.join(process.cwd(), '.openclaw', 'plugins', 'algo-memory', 'src', 'index.ts');
      const dir = path.dirname(updatePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      
      fs.writeFileSync(updatePath, newCode, 'utf8');
      
      // 保存版本号
      this.saveVersion();
      
      console.log('[Memory] 从文件更新完成，请重启 OpenClaw');
      
      return { success: true, message: '更新完成，请重启 OpenClaw' };
    } catch (error) {
      console.error('[Memory] 从文件更新失败:', error);
      return { success: false, message: `更新失败: ${error}` };
    }
  }
}

// ============= OpenClaw 钩子 =============
let memoryPlugin: MemoryPlugin;

export async function onload(context: any): Promise<void> {
  const config = context.config?.plugins?.entries?.['algo-memory']?.config || {};
  
  memoryPlugin = new MemoryPlugin(config);
  await memoryPlugin.init();

  // 注册钩子
  context.hooks.on('agent_end', async (agent: any, messages: any[]) => {
    const agentId = typeof agent === 'object' ? agent.id : agent;
    if (config.autoCapture) {
      await memoryPlugin.store(agentId, messages);
    }
  });

  context.hooks.on('before_agent_start', async (agent: any, ctx: any) => {
    const agentId = typeof agent === 'object' ? agent.id : agent;
    if (config.autoRecall) {
      const result = await memoryPlugin.recall(agentId, ctx.input || '');
      if (result.hasMemory && result.memories.length > 0) {
        const memoryText = result.memories
          .map(m => `• ${m.content}`)
          .join('\n');
        
        ctx.systemPrompt = ctx.systemPrompt || '';
        // 安全转义内容，防止注入
        const safeText = memoryText.replace(/</g, '&lt;').replace(/>/g, '&gt;');
        ctx.systemPrompt += `\n\n<relevant-memories>\n${safeText}\n</relevant-memories>`;
      }
    }
  });

  context.hooks.on('agent:delete', async (agentId: string) => {
    await memoryPlugin.deleteAgent(agentId);
  });

  // 注册 CLI 命令
  const cli = context.cli;
  if (cli) {
    cli.register('memory', {
      description: 'algo-memory 记忆管理 - 查看/搜索/删除记忆，统计清理等',
      commands: {
        list: {
          description: '列出某Agent的记忆 - 查看记忆列表',
          aliases: ['ls', '列出', '查看记忆'],
          options: [
            { name: 'agent', alias: 'a', description: 'Agent ID (必填)', examples: ['agent_001', 'my-agent'] },
            { name: 'limit', alias: 'l', defaultValue: 20, description: '显示数量', examples: ['10', '50'] }
          ],
          examples: [
            'memory list -a agent_001',
            '查看 agent001 的记忆',
            '列出我的记忆'
          ],
          execute: async (opts: any) => {
            if (!opts.agent) {
              return { type: 'text', content: '错误: 请指定 agent ID (-a <agent-id>)' };
            }
            const memories = memoryPlugin.listMemories(opts.agent, opts.limit || 20);
            // 格式化输出
            const output = memories.map(m => 
              `[${m.layer.toUpperCase()}] ${m.id}\n  内容: ${m.content}\n  类型: ${m.type} | 访问: ${m.access_count}次 | 创建: ${new Date(m.created_at).toLocaleString()}\n`
            ).join('\n');
            return { type: 'text', content: output || '暂无记忆' };
          }
        },
        'get-detail': {
          description: '查看单条记忆详情 - 输入记忆ID查看完整内容',
          aliases: ['detail', '详情', '查看'],
          options: [
            { name: 'id', alias: 'i', required: true, description: '记忆 ID', examples: ['memory_abc123'] }
          ],
          examples: [
            'memory get-detail -i memory_abc123',
            '查看这条记忆的详情'
          ],
          execute: async (opts: any) => {
            if (!opts.id) {
              return { type: 'text', content: '错误: 请指定记忆 ID (-i <memory-id>)' };
            }
            const memory = memoryPlugin.getMemoryDetail(opts.id);
            if (!memory) {
              return { type: 'text', content: '记忆不存在' };
            }
            const output = `记忆详情:
  ID: ${memory.id}
  Agent: ${memory.agent_id}
  内容: ${memory.content}
  类型: ${memory.type}
  层级: ${memory.layer}
  关键词: ${memory.keywords}
  重要性: ${memory.importance}
  访问次数: ${memory.access_count}
  创建时间: ${new Date(memory.created_at).toLocaleString()}
  最后访问: ${new Date(memory.last_accessed).toLocaleString()}`;
            return { type: 'text', content: output };
          }
        },
        search: {
          description: '搜索记忆 - 按关键词搜索Agent的记忆',
          aliases: ['find', '查找', '搜索', '找'],
          options: [
            { name: 'agent', alias: 'a', description: 'Agent ID (必填)' },
            { name: 'query', alias: 'q', required: true, description: '搜索关键词', examples: ['喜欢', '蓝色', '密码'] }
          ],
          examples: [
            'memory search -a agent_001 -q 蓝色',
            '搜索 agent001 关于蓝色的记忆'
          ],
          execute: async (opts: any) => {
            if (!opts.agent) {
              return { type: 'text', content: '错误: 请指定 agent ID (-a <agent-id>)' };
            }
            const memories = memoryPlugin.searchMemories(opts.agent, opts.query);
            return { type: 'text', content: JSON.stringify(memories, null, 2) };
          }
        },
        stats: {
          description: '查看记忆统计 - 统计记忆数量、类型、访问次数等',
          aliases: ['stat', '统计', '数量', '信息'],
          options: [
            { name: 'agent', alias: 'a', description: 'Agent ID (不填则查全局)' }
          ],
          examples: [
            'memory stats',
            'memory stats -a agent_001',
            '查看我的记忆统计'
          ],
          execute: async (opts: any) => {
            const stats = memoryPlugin.getStats(opts.agent || undefined);
            return { type: 'text', content: JSON.stringify(stats, null, 2) };
          }
        },
        'delete-agent': {
          description: '删除Agent及所有记忆 - 删除某个Agent的全部记忆',
          aliases: ['del-agent', '删除Agent', '清除'],
          options: [
            { name: 'agent', alias: 'a', required: true, description: 'Agent ID (必填)' }
          ],
          examples: [
            'memory delete-agent -a agent_001',
            '删除 agent001 的所有记忆'
          ],
          execute: async (opts: any) => {
            if (!opts.agent) {
              return { type: 'text', content: '错误: 请指定 agent ID (-a <agent-id>)' };
            }
            const count = await memoryPlugin.deleteAgent(opts.agent);
            return { type: 'text', content: `已删除 Agent ${opts.agent} 的 ${count} 条记忆` };
          }
        },
        'delete-memory': {
          description: '删除单条记忆 - 根据记忆ID删除',
          aliases: ['del', '删除', '移除'],
          options: [
            { name: 'id', alias: 'i', required: true, description: '记忆 ID' }
          ],
          examples: [
            'memory delete-memory -i memory_abc123',
            '删除这条记忆'
          ],
          execute: async (opts: any) => {
            if (!opts.id) {
              return { type: 'text', content: '错误: 请指定记忆 ID (-i <memory-id>)' };
            }
            const result = memoryPlugin.deleteMemory(opts.id);
            if (result) {
              return { type: 'text', content: `已删除记忆 ${opts.id}` };
            }
            return { type: 'text', content: `删除失败: 记忆不存在` };
          }
        },
        'update-memory': {
          description: '更新记忆内容 - 修改某条记忆的内容',
          aliases: ['edit', '修改', '编辑'],
          options: [
            { name: 'id', alias: 'i', required: true, description: '记忆 ID' },
            { name: 'content', alias: 'c', required: true, description: '新内容' }
          ],
          examples: [
            'memory update-memory -i memory_abc123 -c 新内容',
            '修改这条记忆的内容'
          ],
          execute: async (opts: any) => {
            if (!opts.id || !opts.content) {
              return { type: 'text', content: '错误: 请指定记忆 ID (-i) 和新内容 (-c)' };
            }
            const result = memoryPlugin.updateMemory(opts.id, opts.content);
            if (result) {
              return { type: 'text', content: `更新记忆 ${opts.id} 成功` };
            }
            return { type: 'text', content: '更新失败: 记忆不存在' };
          }
        },
        cleanup: {
          description: '清理过期记忆 - 清理超过180天的普通记忆',
          aliases: ['clean', '清理', '清除过期'],
          examples: [
            'memory cleanup',
            '清理过期记忆'
          ],
          execute: async () => {
            const count = await memoryPlugin.cleanupExpired();
            return { type: 'text', content: `已清理 ${count} 条过期记忆` };
          }
        },
        'check-update': {
          description: '检查更新 - 检查GitHub是否有新版本',
          aliases: ['version', '版本', '检查版本'],
          examples: [
            'memory check-update',
            '检查是否有新版本'
          ],
          execute: async () => {
            const result = await memoryPlugin.checkUpdate();
            if (result.hasUpdate) {
              return { type: 'text', content: `发现新版本: ${result.latestVersion} (当前: ${result.currentVersion})\n使用 memory update 更新` };
            }
            return { type: 'text', content: `当前已是最新版本: ${result.currentVersion}` };
          }
        },
        update: {
          description: '更新插件 - 从GitHub拉取最新代码',
          aliases: ['upgrade', '升级', '更新'],
          examples: [
            'memory update',
            '更新插件到最新版本'
          ],
          execute: async () => {
            const result = await memoryPlugin.updateFromGitHub();
            return { type: 'text', content: result.message };
          }
        },
        'update-file': {
          description: '从文件更新 - 从本地文件更新插件',
          aliases: ['file', '文件更新'],
          options: [
            { name: 'path', alias: 'p', required: true, description: '文件路径' }
          ],
          examples: [
            'memory update-file -p ./algo-memory.zip',
            '从文件更新插件'
          ],
          execute: async (opts: any) => {
            if (!opts.path) {
              return { type: 'text', content: '错误: 请指定文件路径 (-p <path>)' };
            }
            const result = await memoryPlugin.updateFromFile(opts.path);
            return { type: 'text', content: result.message };
          }
        },
        'bump-version': {
          description: '增加版本后缀 - 同一天多次发布时使用',
          aliases: ['bump', '版本号', '更新版本'],
          examples: [
            'memory bump-version',
            '增加版本号'
          ],
          execute: async () => {
            memoryPlugin.bumpVersion();
            return { type: 'text', content: '版本号已更新' };
          }
        },
        'import-openclaw': {
          description: '从OpenClaw内置记忆导入 - 扫描agents目录导入对话历史',
          aliases: ['import', '导入', '迁移'],
          options: [
            { name: 'agent', alias: 'a', description: 'Agent ID (不填则导入所有)' }
          ],
          examples: [
            'memory import-openclaw',
            'memory import-openclaw -a coder',
            '导入 coder 的对话历史'
          ],
          execute: async (opts: any) => {
            const result = await memoryPlugin.importFromOpenClaw(opts.agent);
            return { type: 'text', content: `导入完成!\n新增: ${result.stored}\n跳过: ${result.skipped}\n合并: ${result.merged}\n错误: ${result.errors}` };
          }
        }
      }
    });
  }

  console.log('[Memory] algo-memory 插件加载完成');
}

export async function onunload(): Promise<void> {
  if (memoryPlugin) {
    memoryPlugin.close();
  }
}

  private async processAndStore(agentId: string, content: string): Promise<void> {
    // 1. 分类
    let type = ruleClassify(content);
    let keywords = extractKeywords(content);
    
    // 2. LLM 增强 (可选)
    if (this.config.llm.enabled && content.length > this.config.llm.thresholdLength) {
      try {
        const enhanced = await this.llmEnhance(content);
        if (enhanced) {
          if (enhanced.type) type = enhanced.type;
          if (enhanced.keywords && enhanced.keywords !== '[]') keywords = enhanced.keywords;
        }
      } catch (error) {
        console.error('[Memory] LLM 增强失败:', error);
      }
    }

    // 3. XSS 转义
    const safeContent = content.replace(/</g, '&lt;').replace(/>/g, '&gt;');
    
    // 4. 哈希计算 (基于转义后的内容)
    const contentHash = hashContent(safeContent);
    
    // 5. 哈希查重
    const existing = this.db.prepare(
      'SELECT id FROM memories WHERE agent_id = ? AND content_hash = ?'
    ).get(agentId, contentHash) as { id: string } | undefined;

    if (existing) {
      this.db.prepare('UPDATE memories SET access_count = access_count + 1, last_accessed = ? WHERE id = ?').run(Date.now(), existing.id);
      this.invalidateCache(agentId);
      return;
    }

    // 6. 智能去重 (Jaccard)
    const dedup = await this.smartDedup(agentId, safeContent);
    
    if (dedup.existingId) {
      if (dedup.result === 'DUPLICATE') {
        this.db.prepare('UPDATE memories SET access_count = access_count + 1, last_accessed = ? WHERE id = ?').run(Date.now(), dedup.existingId);
        this.invalidateCache(agentId);
        return;
      } else if (dedup.result === 'UPDATE') {
        const oldMemory = this.db.prepare('SELECT content, keywords FROM memories WHERE id = ?').get(dedup.existingId) as { content: string; keywords: string } | undefined;
        if (oldMemory) {
          const mergedContent = oldMemory.content + '\n' + safeContent;
          const safeMerged = mergedContent.replace(/</g, '&lt;').replace(/>/g, '&gt;');
          const mergedKeywords = extractKeywords(safeMerged);
          this.db.prepare('UPDATE memories SET content = ?, keywords = ?, access_count = access_count + 1, last_accessed = ? WHERE id = ?').run(safeMerged, mergedKeywords, Date.now(), dedup.existingId);
          this.invalidateCache(agentId);
          return;
        }
      }
    }
    
    // 7. 写入新记忆
    const isCore = isCoreKeyword(content);
    const layer: 'core' | 'general' = isCore ? 'core' : 'general';
    const importance = isCore ? 1.0 : 0.5;
    const safeKeywords = extractKeywords(safeContent);
    
    const memory: Memory = {
      id: generateId(),
      agent_id: agentId,
      content: safeContent,
      type,
      layer,
      keywords: safeKeywords,
      importance,
      access_count: 1,
      created_at: Date.now(),
      last_accessed: Date.now(),
      content_hash: contentHash
    };

    const insertMemory = this.db.prepare(`
      INSERT INTO memories (id, agent_id, content, type, layer, keywords, importance, access_count, created_at, last_accessed, content_hash)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const transaction = this.db.transaction(() => {
      insertMemory.run(
        memory.id, memory.agent_id, memory.content, memory.type, memory.layer,
        memory.keywords, memory.importance, memory.access_count,
        memory.created_at, memory.last_accessed, memory.content_hash
      );
      this.db.prepare('INSERT INTO memories_fts (id, content, keywords) VALUES (?, ?, ?)').run(memory.id, safeContent, safeKeywords);
    });
    
    transaction();
    this.invalidateCache(agentId);
  }
