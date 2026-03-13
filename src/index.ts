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
const GITHUB_REPO = 'xcqblue/memory-local-enhanced';
const GITHUB_RAW_BASE = 'https://raw.githubusercontent.com/xcqblue/memory-local-enhanced/master';

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
    /^好的|^收到|^了解|^ok|^okay|^好滴|^明白了/i,
    /^(thanks|thank you)/i,
    /^(好的|收到|了解|明白)/i,
    /^[\s]*$/,
    /^[\.。!?！?]+$/
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
  if (/比如|例如|such as/i.test(c)) {
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
  private cleanupTimer: NodeJS.Timeout | null = null;

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

    // 启动定时清理任务 (每天检查一次, 防重)
    if (!this.cleanupTimer) {
      this.cleanupTimer = setInterval(() => {
        this.cleanupExpired().catch(err => console.error('[Memory] 定时清理失败:', err));
      }, 24 * 60 * 60 * 1000);
    }
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
  private async processAndStore(agentId: string, content: string): Promise<void> {
    // 1. 分类
    let type = ruleClassify(content);
    let keywords = extractKeywords(content);
    
    // 2. LLM 增强 (可选)
    if (this.config.llm.enabled && content.length > this.config.llm.thresholdLength) {
      try {
        const enhanced = await this.llmEnhance(content);
        if (enhanced) {
          // 只有 LLM 返回合法 type 时才使用
          if (enhanced.type) {
            type = enhanced.type;
          }
          // 只有 LLM 返回有效关键词时才使用
          if (enhanced.keywords && enhanced.keywords !== '[]') {
            keywords = enhanced.keywords;
          }
        }
      } catch (error) {
        console.error('[Memory] LLM 增强失败:', error);
      }
    }

    // 3. 哈希去重
    const contentHash = hashContent(content);
    const existing = this.db.prepare(
      'SELECT id FROM memories WHERE agent_id = ? AND content_hash = ?'
    ).get(agentId, contentHash) as { id: string } | undefined;

    if (existing) {
      // 更新访问时间
      this.db.prepare(
        'UPDATE memories SET access_count = access_count + 1, last_accessed = ? WHERE id = ?'
      ).run(Date.now(), existing.id);
    } else {
      // 写入新记忆 (使用事务保证一致性)
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
        
        // 插入 FTS 索引 (使用 memory id 关联)
        this.db.prepare('INSERT INTO memories_fts (id, content, keywords) VALUES (?, ?, ?)')
          .run(memory.id, content, keywords);
      });
      
      transaction();
    }

    // 4. 清理缓存
    this.invalidateCache(agentId);
  }

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
        return {
          type,
          keywords: result.keywords ? JSON.stringify(result.keywords.split(',').map((k: string) => k.trim()).filter(Boolean).slice(0, 10)) : undefined
        };
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
      // 有查询词：优先 core + 关键词匹配
      memories = this.db.prepare(`
        SELECT * FROM memories 
        WHERE agent_id = ?
        AND (content LIKE ? OR keywords LIKE ?)
        ORDER BY 
          CASE layer WHEN 'core' THEN 0 ELSE 1 END,
          importance DESC, access_count DESC, last_accessed DESC
        LIMIT ?
      `).all(agentId, `%${query}%`, `%${query}%`, this.config.maxResults) as Memory[];
    } else {
      // 无查询词：返回最近的和重要的
      memories = this.db.prepare(`
        SELECT * FROM memories 
        WHERE agent_id = ?
        ORDER BY 
          CASE layer WHEN 'core' THEN 0 ELSE 1 END,
          importance DESC, access_count DESC, last_accessed DESC
        LIMIT ?
      `).all(agentId, this.config.maxResults) as Memory[];
    }

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

  // 删除 Agent 记忆 (修复: 同时删除 FTS 索引)
  async deleteAgent(agentId: string): Promise<void> {
    // 防御检查
    if (!agentId) {
      console.warn('[Memory] 无效 Agent ID');
      return;
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
    });
    
    transaction();
    
    // 清理缓存
    this.invalidateCache(agentId);
    
    console.log(`[Memory] 已删除 Agent ${agentId} 的所有记忆`);
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

  // 检查 GitHub 更新
  async checkUpdate(): Promise<{ hasUpdate: boolean; latestCommit: string; currentCommit: string }> {
    try {
      // 获取当前版本
      const currentCommit = '1cd47ef'; // 当前提交ID
      
      // 获取最新版本
      const response = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/commits/master`);
      const data = await response.json();
      const latestCommit = data.sha?.substring(0, 7) || 'unknown';
      
      return {
        hasUpdate: latestCommit !== currentCommit,
        latestCommit,
        currentCommit
      };
    } catch (error) {
      console.error('[Memory] 检查更新失败:', error);
      return { hasUpdate: false, latestCommit: 'unknown', currentCommit: 'unknown' };
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
      const updatePath = path.join(process.cwd(), '.openclaw', 'plugins', 'memory-local-enhanced', 'src', 'index.ts');
      const dir = path.dirname(updatePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      
      fs.writeFileSync(updatePath, newCode, 'utf8');
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
      const updatePath = path.join(process.cwd(), '.openclaw', 'plugins', 'memory-local-enhanced', 'src', 'index.ts');
      const dir = path.dirname(updatePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      
      fs.writeFileSync(updatePath, newCode, 'utf8');
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
      description: '记忆管理命令',
      commands: {
        list: {
          description: '列出记忆',
          options: [
            { name: 'agent', alias: 'a', description: 'Agent ID' },
            { name: 'limit', alias: 'l', defaultValue: 20 }
          ],
          execute: async (opts: any) => {
            if (!opts.agent) {
              return { type: 'text', content: '错误: 请指定 agent ID (-a <agent-id>)' };
            }
            const memories = memoryPlugin.listMemories(opts.agent, opts.limit || 20);
            return { type: 'text', content: JSON.stringify(memories, null, 2) };
          }
        },
        search: {
          description: '搜索记忆',
          options: [
            { name: 'agent', alias: 'a', description: 'Agent ID' },
            { name: 'query', alias: 'q', required: true, description: '搜索关键词' }
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
          description: '查看统计',
          options: [
            { name: 'agent', alias: 'a', description: 'Agent ID (不填则全局)' }
          ],
          execute: async (opts: any) => {
            const stats = memoryPlugin.getStats(opts.agent || undefined);
            return { type: 'text', content: JSON.stringify(stats, null, 2) };
          }
        },
        'delete-agent': {
          description: '删除 Agent 及记忆',
          options: [
            { name: 'agent', alias: 'a', required: true, description: 'Agent ID' }
          ],
          execute: async (opts: any) => {
            if (!opts.agent) {
              return { type: 'text', content: '错误: 请指定 agent ID (-a <agent-id>)' };
            }
            await memoryPlugin.deleteAgent(opts.agent);
            return { type: 'text', content: `已删除 Agent ${opts.agent} 的所有记忆` };
          }
        },
        cleanup: {
          description: '清理过期记忆',
          execute: async () => {
            const count = await memoryPlugin.cleanupExpired();
            return { type: 'text', content: `已清理 ${count} 条过期记忆` };
          }
        },
        'check-update': {
          description: '检查 GitHub 是否有新版本',
          execute: async () => {
            const result = await memoryPlugin.checkUpdate();
            if (result.hasUpdate) {
              return { type: 'text', content: `发现新版本: ${result.latestCommit} (当前: ${result.currentCommit})\n使用 memory update 更新` };
            }
            return { type: 'text', content: `当前已是最新版本: ${result.currentCommit}` };
          }
        },
        update: {
          description: '从 GitHub 更新插件',
          execute: async () => {
            const result = await memoryPlugin.updateFromGitHub();
            return { type: 'text', content: result.message };
          }
        },
        'update-file': {
          description: '从本地文件更新插件',
          options: [
            { name: 'path', alias: 'p', required: true, description: '文件路径' }
          ],
          execute: async (opts: any) => {
            if (!opts.path) {
              return { type: 'text', content: '错误: 请指定文件路径 (-p <path>)' };
            }
            const result = await memoryPlugin.updateFromFile(opts.path);
            return { type: 'text', content: result.message };
          }
        }
      }
    });
  }

  console.log('[Memory] memory-local-enhanced 插件加载完成');
}

export async function onunload(): Promise<void> {
  if (memoryPlugin) {
    memoryPlugin.close();
  }
}
