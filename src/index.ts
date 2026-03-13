/**
 * algo-memory v1.4.0
 * 纯算法长期记忆插件 - 0 API / 可选 LLM 增强
 * 借鉴 memory-lancedb-pro 架构优化
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
  // 基础功能
  noiseFilter: { enabled: boolean; skipGreetings: boolean; skipCommands: boolean };
  adaptiveRetrieval: { enabled: boolean; minQueryLength: number; forceKeywords: string[] };
  sessionMemory: { enabled: boolean; maxSessionItems: number };
  // 进阶功能
  weibullDecay: { enabled: boolean; shape: number; scale: number };
  reinforcement: { enabled: boolean; factor: number; maxMultiplier: number };
  mmr: { enabled: boolean; threshold: number };
  lengthNorm: { enabled: boolean; anchor: number };
  hardMinScore: { enabled: boolean; threshold: number };
  // 三层晋升
  tier: { enabled: boolean; coreThreshold: number; peripheralThreshold: number; ageDays: number };
  // 多 Scope
  scopes: { enabled: boolean; defaultScope: string };
  // 架构优化
  capturePerTurn: number; // 每轮最多写入数
  // LLM
  llm: { enabled: boolean; provider: string; apiKey: string; model: string; baseURL: string };
  threshold: { useLlmForCore: boolean; useLlmForExtract: boolean; useLlmForDedup: boolean; minConfidence: number };
}

const DEFAULT_CONFIG: Config = {
  autoCapture: true,
  autoRecall: true,
  maxResults: 5,
  cleanupDays: 180,
  coreKeywords: ['记住', '牢记', '重要', '不要忘记', '记住它', '这是关键', '永久保留', '一直记住', '别忘了', 'remember', 'important', 'never forget', 'always remember'],
  recencyDecay: true,
  recencyHalfLife: 180,
  smartDedup: true,
  dedupThreshold: 0.85,
  // 基础
  noiseFilter: { enabled: true, skipGreetings: true, skipCommands: true },
  adaptiveRetrieval: { enabled: true, minQueryLength: 2, forceKeywords: ['记住', '之前', '上次', '记得', 'remember', 'before', 'last'] },
  sessionMemory: { enabled: false, maxSessionItems: 10 },
  // 进阶
  weibullDecay: { enabled: false, shape: 1.5, scale: 90 },
  reinforcement: { enabled: false, factor: 0.5, maxMultiplier: 3 },
  mmr: { enabled: false, threshold: 0.85 },
  lengthNorm: { enabled: false, anchor: 500 },
  hardMinScore: { enabled: false, threshold: 0.35 },
  // 三层晋升
  tier: { enabled: false, coreThreshold: 10, peripheralThreshold: 0.15, ageDays: 60 },
  // Scope
  scopes: { enabled: false, defaultScope: 'agent' },
  // 架构优化
  capturePerTurn: 3, // 每轮最多写入3条
  // LLM
  llm: { enabled: false, provider: 'openai', apiKey: '', model: 'gpt-4o-mini', baseURL: 'https://api.openai.com/v1' },
  threshold: { useLlmForCore: false, useLlmForExtract: false, useLlmForDedup: false, minConfidence: 0.8 }
};

// ============= 工具函数 =============
function generateId(): string { return 'mem_' + crypto.randomBytes(8).toString('hex'); }
function hashContent(content: string): string { return crypto.createHash('sha256').update(content).digest('hex'); }
function extractKeywords(content: string): string {
  const words = content.toLowerCase().match(/[\u4e00-\u9fa5a-zA-Z0-9]{2,}/g) || [];
  return [...new Set(words)].slice(0, 10).join(',');
}
function isCoreKeyword(content: string, keywords: string[]): boolean { return keywords.some(k => content.includes(k)); }

// 文本归一化 (借鉴 memory-lancedb-pro)
function normalizeText(text: string): string {
  let normalized = text.trim();
  // 去除 addressing (如 @bot 或 @agent)
  normalized = normalized.replace(/^@\w+\s+/, '');
  // 去除多余空白
  normalized = normalized.replace(/\s+/g, ' ').trim();
  // 去除 OpenClaw 注入前缀
  normalized = normalized.replace(/^(以下是|根据|按照).*?:?\s*/i, '');
  return normalized;
}

// 噪声过滤
function isNoise(content: string, config: Config['noiseFilter']): boolean {
  if (!config.enabled) return false;
  const lower = content.toLowerCase().trim();
  if (config.skipGreetings) {
    const greetings = ['hi', 'hello', 'hey', '你好', '您好', '嗨'];
    if (greetings.some(g => lower === g || lower.startsWith(g + ' '))) return true;
  }
  if (config.skipCommands) {
    if (lower.startsWith('/') || lower.startsWith('!') || lower.startsWith('-')) return true;
  }
  const confirms = ['ok', 'okay', '好', '好的', '收到', '了解', '明白', 'yes', 'no', '嗯', '哦'];
  if (confirms.includes(lower)) return true;
  if (!lower || /^[.。!?！?\s]+$/.test(lower)) return true;
  return false;
}

// CJK + 自适应检索
function shouldRetrieve(query: string, config: Config['adaptiveRetrieval']): boolean {
  if (!config.enabled) return true;
  if (!query || query.trim().length < 1) return false;
  const lowerQuery = query.toLowerCase();
  if (config.forceKeywords?.some(k => lowerQuery.includes(k))) return true;
  const isCJK = /[\u4e00-\u9fa5]/.test(query);
  const minLen = isCJK ? 6 : 15;
  if (query.trim().length < minLen) return false;
  return true;
}

// Jaccard
function jaccardSimilarity(text1: string, text2: string): number {
  const words1 = new Set(text1.toLowerCase().match(/[\u4e00-\u9fa5a-zA-Z0-9]{2,}/g) || []);
  const words2 = new Set(text2.toLowerCase().match(/[\u4e00-\u9fa5a-zA-Z0-9]{2,}/g) || []);
  if (words1.size === 0 || words2.size === 0) return 0;
  const intersection = new Set([...words1].filter(x => words2.has(x)));
  const union = new Set([...words1, ...words2]);
  return intersection.size / union.size;
}

// Weibull 衰减
function weibullDecay(daysOld: number, shape: number, scale: number): number {
  return Math.exp(-Math.pow(daysOld / scale, shape));
}

// 长度归一化
function lengthNorm(content: string, anchor: number): number {
  const len = content.length;
  if (len <= anchor) return 1.0;
  return anchor / len;
}

// 访问强化
function reinforcementFactor(accessCount: number, config: Config['reinforcement']): number {
  if (!config.enabled || accessCount <= 1) return 1.0;
  return Math.min(config.maxMultiplier, 1.0 + (accessCount - 1) * config.factor);
}

// MMR
function mmrDeduplicate(items: any[], config: Config['mmr']): any[] {
  if (!config.enabled || items.length <= 1) return items;
  const result: any[] = [];
  const scores = items.map(m => ({ ...m, _score: m._score || m.importance }));
  while (scores.length > 0) {
    scores.sort((a, b) => b._score - a._score);
    const top = scores.shift()!;
    result.push(top);
    const remaining: any[] = [];
    for (const item of scores) {
      const sim = jaccardSimilarity(top.content, item.content);
      if (sim < config.threshold) remaining.push(item);
    }
    scores.length = 0;
    scores.push(...remaining);
  }
  return result;
}

// 三层晋升
function getTier(importance: number, accessCount: number, daysOld: number, config: Config['tier']): 'core' | 'working' | 'peripheral' {
  if (!config.enabled) return importance >= 1.0 ? 'core' : 'working';
  const compositeScore = importance * (1 + Math.log10(accessCount + 1));
  if (accessCount >= config.coreThreshold || compositeScore >= 0.7) return 'core';
  if (compositeScore < config.peripheralThreshold || daysOld > config.ageDays) return 'peripheral';
  return 'working';
}

// LLM 客户端
class LLMClient {
  private config: Config['llm'];
  private log: any;
  constructor(config: Config['llm'], log: any) { this.config = config; this.log = log; }
  async isCoreMemory(content: string): Promise<{ isCore: boolean; confidence: number }> {
    const localResult = isCoreKeyword(content, DEFAULT_CONFIG.coreKeywords);
    if (localResult) return { isCore: true, confidence: 1.0 };
    if (!this.config.enabled) return { isCore: false, confidence: 0.5 };
    try {
      const response = await fetch(`${this.config.baseURL}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.config.apiKey}` },
        body: JSON.stringify({ model: this.config.model, messages: [{ role: 'system', content: '判断是否重要需要长期记住。回复JSON: {"isCore": true/false, "confidence": 0-1}' }, { role: 'user', content }], max_tokens: 100, temperature: 0.1 })
      });
      return JSON.parse((await response.json()).choices[0].message.content);
    } catch (err) { this.log.error('[algo-memory] LLM错误:', err); return { isCore: false, confidence: 0.5 }; }
  }
  async extractKeywords(content: string): Promise<string> {
    const local = extractKeywords(content);
    if (!this.config.enabled) return local;
    try {
      const response = await fetch(`${this.config.baseURL}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.config.apiKey}` },
        body: JSON.stringify({ model: this.config.model, messages: [{ role: 'system', content: '提取关键词，最多10个。回复JSON: {"keywords": ["k1", "k2"]}' }, { role: 'user', content }], max_tokens: 200, temperature: 0.2 })
      });
      return JSON.parse((await response.json()).choices[0].message.content).keywords.join(',');
    } catch (err) { return local; }
  }
  async isDuplicate(c1: string, c2: string): Promise<{ isDuplicate: boolean; similarity: number }> {
    const sim = jaccardSimilarity(c1, c2);
    if (sim >= 0.98 || sim < 0.5) return { isDuplicate: sim >= 0.98, similarity: sim };
    if (!this.config.enabled) return { isDuplicate: false, similarity: sim };
    try {
      const response = await fetch(`${this.config.baseURL}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.config.apiKey}` },
        body: JSON.stringify({ model: this.config.model, messages: [{ role: 'system', content: '判断是否重复。回复JSON: {"isDuplicate": true/false, "similarity": 0-1}' }, { role: 'user', content: `内容1: ${c1}\n内容2: ${c2}` }], max_tokens: 100, temperature: 0.1 })
      });
      return JSON.parse((await response.json()).choices[0].message.content);
    } catch (err) { return { isDuplicate: sim >= 0.85, similarity: sim }; }
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
    if (this.config.llm.enabled) this.llmClient = new LLMClient(this.config.llm, log);
  }

  async init(stateDir: string): Promise<void> {
    if (!fs.existsSync(stateDir)) fs.mkdirSync(stateDir, { recursive: true });
    const dbPath = path.join(stateDir, 'memories.db');
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('busy_timeout = 5000');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY, agent_id TEXT NOT NULL, scope TEXT DEFAULT 'agent',
        content TEXT NOT NULL, type TEXT DEFAULT 'other', tier TEXT DEFAULT 'working',
        layer TEXT DEFAULT 'general', keywords TEXT, importance REAL DEFAULT 0.5,
        access_count INTEGER DEFAULT 0, created_at INTEGER, last_accessed INTEGER, content_hash TEXT,
        metadata TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_agent ON memories(agent_id);
      CREATE INDEX IF NOT EXISTS idx_tier ON memories(tier);
      CREATE INDEX IF NOT EXISTS idx_scope ON memories(scope);
      CREATE INDEX IF NOT EXISTS idx_agent_hash ON memories(agent_id, content_hash);
    `);
    this.log.info('[algo-memory] 数据库初始化:', dbPath);
    this.log.info(`[algo-memory] 每轮最多写入: ${this.config.capturePerTurn} 条`);
    this.cleanupInterval = setInterval(() => this.cleanup(), 24 * 60 * 60 * 1000);
  }

  async store(AgentId: string, messages: any[]): Promise<void> {
    if (!AgentId || !messages?.length || !this.db) return;
    
    let captured = 0;
    const maxCapture = this.config.capturePerTurn || 3;
    
    for (const msg of messages) {
      if (captured >= maxCapture) break;
      if (msg.role !== 'user') continue;
      
      // 文本归一化
      const content = normalizeText(msg.content);
      if (!content || isNoise(content, this.config.noiseFilter)) continue;
      
      const safeContent = content.replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const contentHash = hashContent(safeContent);

      // 精确查重
      const existing = this.db.prepare('SELECT id FROM memories WHERE agent_id = ? AND content_hash = ?').get(AgentId, contentHash) as { id: string } | undefined;
      if (existing) {
        this.db.prepare('UPDATE memories SET access_count = access_count + 1, last_accessed = ? WHERE id = ?').run(Date.now(), existing.id);
        this.cache.delete(`recall:${AgentId}`);
        this.updateTier(existing.id);
        continue;
      }

      // 智能去重
      if (this.config.smartDedup) {
        const similar = this.db.prepare("SELECT id, content FROM memories WHERE agent_id = ? ORDER BY created_at DESC LIMIT 10").all(AgentId) as { id: string; content: string }[];
        for (const s of similar) {
          let isDup = false, score = jaccardSimilarity(safeContent, s.content);
          if (this.config.threshold.useLlmForDedup && this.llmClient && score >= 0.5 && score < 0.98) {
            const r = await this.llmClient.isDuplicate(safeContent, s.content);
            isDup = r.isDuplicate; score = r.similarity;
          } else if (score >= 0.98) { isDup = true; }
          if (isDup) {
            this.db.prepare('UPDATE memories SET access_count = access_count + 1, last_accessed = ? WHERE id = ?').run(Date.now(), s.id);
            this.cache.delete(`recall:${AgentId}`);
            captured++;
            break;
          }
        }
        if (captured >= maxCapture) break;
        continue;
      }

      // 核心判断
      let isCore = isCoreKeyword(safeContent, this.config.coreKeywords);
      let keywords = extractKeywords(safeContent);
      let importance = isCore ? 1.0 : 0.5;
      if (this.config.threshold.useLlmForCore && this.llmClient && !isCore) {
        const r = await this.llmClient.isCoreMemory(safeContent);
        isCore = r.isCore; importance = r.confidence;
      }
      if (this.config.threshold.useLlmForExtract && this.llmClient) keywords = await this.llmClient.extractKeywords(safeContent);

      const scope = this.config.scopes.enabled ? `${this.config.scopes.defaultScope}:${AgentId}` : 'global';
      const tier = getTier(importance, 1, 0, this.config.tier);
      
      // Smart metadata
      const metadata = JSON.stringify({
        memory_category: isCore ? 'fact' : 'other',
        confidence: importance,
        source_session: AgentId,
        l0_abstract: safeContent.substring(0, 100)
      });

      const memory = { id: generateId(), agent_id: AgentId, scope, content: safeContent, type: 'other', tier, layer: isCore ? 'core' : 'general', keywords, importance, access_count: 1, created_at: Date.now(), last_accessed: Date.now(), content_hash: contentHash, metadata };
      this.db.prepare('INSERT INTO memories (id, agent_id, scope, content, type, tier, layer, keywords, importance, access_count, created_at, last_accessed, content_hash, metadata) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(memory.id, memory.agent_id, memory.scope, memory.content, memory.type, memory.tier, memory.layer, memory.keywords, memory.importance, memory.access_count, memory.created_at, memory.last_accessed, memory.content_hash, memory.metadata);
      captured++;
    }
  }

  private updateTier(memoryId: string): void {
    if (!this.config.tier.enabled || !this.db) return;
    const mem = this.db.prepare('SELECT importance, access_count, created_at FROM memories WHERE id = ?').get(memoryId) as { importance: number; access_count: number; created_at: number };
    if (!mem) return;
    const daysOld = (Date.now() - mem.created_at) / (1000 * 60 * 60 * 24);
    const newTier = getTier(mem.importance, mem.access_count, daysOld, this.config.tier);
    this.db.prepare('UPDATE memories SET tier = ? WHERE id = ?').run(newTier, memoryId);
  }

  async recall(AgentId: string, query: string): Promise<{ hasMemory: boolean; memories: any[] }> {
    if (!shouldRetrieve(query, this.config.adaptiveRetrieval)) return { hasMemory: false, memories: [] };
    const cacheKey = `recall:${AgentId}:${query}`;
    if (this.cache.has(cacheKey)) return this.cache.get(cacheKey)!;

    let memories = this.db!.prepare("SELECT * FROM memories WHERE agent_id = ? ORDER BY CASE tier WHEN 'core' THEN 0 WHEN 'working' THEN 1 ELSE 2 END, importance DESC, access_count DESC LIMIT ?").all(AgentId, this.config.maxResults * 3) as any[];

    if (this.config.recencyDecay) {
      const halfLife = this.config.recencyHalfLife || 180;
      memories = memories.map(m => {
        const daysOld = (Date.now() - m.last_accessed) / (1000 * 60 * 60 * 24);
        let score = (m.tier === 'core' ? 1.5 : m.tier === 'working' ? 1.0 : 0.5) * m.importance;
        if (this.config.weibullDecay.enabled) {
          score *= weibullDecay(daysOld, this.config.weibullDecay.shape, this.config.weibullDecay.scale);
        } else {
          score *= (0.3 + 0.7 * Math.pow(0.5, daysOld / halfLife));
        }
        score *= reinforcementFactor(m.access_count, this.config.reinforcement);
        if (this.config.lengthNorm.enabled) score *= lengthNorm(m.content, this.config.lengthNorm.anchor);
        return { ...m, _score: score };
      }).sort((a, b) => b._score - a._score);
    }

    if (this.config.mmr.enabled) memories = mmrDeduplicate(memories, this.config.mmr);
    if (this.config.hardMinScore.enabled) memories = memories.filter(m => (m._score || m.importance) >= this.config.hardMinScore.threshold);

    const limited = memories.slice(0, this.config.maxResults);
    const result = { hasMemory: limited.length > 0, memories: limited };
    this.cache.set(cacheKey, result);
    return result;
  }

  addSessionMemory(AgentId: string, content: string): void {
    if (!this.config.sessionMemory.enabled) return;
    const key = `session:${AgentId}`;
    const session = this.sessionCache.get(key) || [];
    session.unshift({ content, time: Date.now() });
    if (session.length > this.config.sessionMemory.maxSessionItems) session.pop();
    this.sessionCache.set(key, session);
  }

  getSessionMemory(AgentId: string): any[] { return this.config.sessionMemory.enabled ? (this.sessionCache.get(`session:${AgentId}`) || []) : []; }

  cleanup(): void {
    if (!this.db) return;
    const cutoff = Date.now() - this.config.cleanupDays * 24 * 60 * 60 * 1000;
    const result = this.db.prepare('DELETE FROM memories WHERE last_accessed < ? AND layer = "general" AND tier = "peripheral"').run(cutoff);
    this.log.info('[algo-memory] 清理了', result.changes, '条过期记忆');
  }

  // 工具
  listMemories(AgentId: string, limit: number = 20): any[] { return this.db!.prepare('SELECT * FROM memories WHERE agent_id = ? ORDER BY tier, importance DESC, created_at DESC LIMIT ?').all(AgentId, limit); }
  searchMemories(AgentId: string, query: string): any[] { const q = `%${query}%`; return this.db!.prepare('SELECT * FROM memories WHERE agent_id = ? AND (content LIKE ? OR keywords LIKE ?) ORDER BY importance DESC LIMIT 20').all(AgentId, q, q); }
  getStats(AgentId: string): { total: number; core: number; working: number; peripheral: number; general: number } {
    const total = (this.db!.prepare('SELECT COUNT(*) as c FROM memories WHERE agent_id = ?').get(AgentId) as { c: number }).c;
    const core = (this.db!.prepare('SELECT COUNT(*) as c FROM memories WHERE agent_id = ? AND tier = "core"').get(AgentId) as { c: number }).c;
    const working = (this.db!.prepare('SELECT COUNT(*) as c FROM memories WHERE agent_id = ? AND tier = "working"').get(AgentId) as { c: number }).c;
    const peripheral = (this.db!.prepare('SELECT COUNT(*) as c FROM memories WHERE agent_id = ? AND tier = "peripheral"').get(AgentId) as { c: number }).c;
    const general = (this.db!.prepare('SELECT COUNT(*) as c FROM memories WHERE agent_id = ? AND layer = "general"').get(AgentId) as { c: number }).c;
    return { total, core, working, peripheral, general };
  }
  getMemory(AgentId: string, memoryId: string): any | null { return this.db!.prepare('SELECT * FROM memories WHERE id = ? AND agent_id = ?').get(memoryId, AgentId) || null; }
  deleteMemory(AgentId: string, memoryId: string): boolean { const r = this.db!.prepare('DELETE FROM memories WHERE id = ? AND agent_id = ?').run(memoryId, AgentId); this.cache.delete(`recall:${AgentId}`); return r.changes > 0; }
  deleteBulk(AgentId: string, memoryIds: string[]): number { const placeholders = memoryIds.map(() => '?').join(','); const r = this.db!.prepare(`DELETE FROM memories WHERE id IN (${placeholders}) AND agent_id = ?`).run(...memoryIds, AgentId); this.cache.delete(`recall:${AgentId}`); return r.changes; }
  clearMemories(AgentId: string, keepCore: boolean = true): number { let r = keepCore ? this.db!.prepare('DELETE FROM memories WHERE agent_id = ? AND tier != "core"').run(AgentId) : this.db!.prepare('DELETE FROM memories WHERE agent_id = ?').run(AgentId); this.cache.delete(`recall:${AgentId}`); return r.changes; }
  updateMemory(AgentId: string, memoryId: string, content: string): boolean { 
    const safe = normalizeText(content).replace(/</g, '&lt;').replace(/>/g, '&gt;'); 
    const isCore = isCoreKeyword(safe, this.config.coreKeywords);
    const tier = getTier(isCore ? 1.0 : 0.5, 1, 0, this.config.tier);
    const r = this.db!.prepare('UPDATE memories SET content = ?, tier = ?, layer = ?, keywords = ?, importance = ?, last_accessed = ? WHERE id = ? AND agent_id = ?').run(safe, tier, isCore ? 'core' : 'general', extractKeywords(safe), isCore ? 1.0 : 0.5, Date.now(), memoryId, AgentId); 
    this.cache.delete(`recall:${AgentId}`); 
    return r.changes > 0; 
  }
  
  exportMemories(AgentId: string): any[] { return this.db!.prepare('SELECT * FROM memories WHERE agent_id = ?').all(AgentId); }
  importMemories(AgentId: string, memories: any[]): number {
    let imported = 0;
    for (const m of memories) {
      try {
        const tier = getTier(m.importance || 0.5, m.access_count || 1, 0, this.config.tier);
        this.db!.prepare('INSERT INTO memories (id, agent_id, scope, content, type, tier, layer, keywords, importance, access_count, created_at, last_accessed, content_hash, metadata) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
          m.id || generateId(), AgentId, m.scope || 'global', m.content, m.type || 'other', tier, m.layer || 'general', m.keywords || '', m.importance || 0.5, m.access_count || 1, m.created_at || Date.now(), m.last_accessed || Date.now(), m.content_hash || hashContent(m.content), m.metadata || null
        );
        imported++;
      } catch (e) { /* ignore */ }
    }
    return imported;
  }

  close(): void { if (this.cleanupInterval) { clearInterval(this.cleanupInterval); this.cleanupInterval = null; } if (this.db) { this.db.close(); this.db = null; } this.log.info('[algo-memory] 插件关闭'); }
}

// ============= 插件定义 =============
const algoMemoryPlugin = {
  id: 'algo-memory', name: 'algo-memory', description: '纯算法长期记忆插件 - 0 API，可选 LLM 增强', kind: 'memory' as const,

  register(api: any): void {
    const log = api.logger || console;
    const plugin = new MemoryPlugin(api.pluginConfig || {}, log);
    const stateDir = api.getStateDir?.() || path.join(process.env.HOME || '/home/x', '.openclaw', 'workspace', 'algo-memory');
    plugin.init(stateDir);

    // 工具 (10个)
    const tools = [
      { name: 'memory_list', desc: '列出记忆', p: { agentId: 'string', limit: 'number' } },
      { name: 'memory_search', desc: '搜索记忆', p: { agentId: 'string', query: 'string' } },
      { name: 'memory_stats', desc: '查看统计', p: { agentId: 'string' } },
      { name: 'memory_get', desc: '获取单条', p: { agentId: 'string', memoryId: 'string' } },
      { name: 'memory_delete', desc: '删除记忆', p: { agentId: 'string', memoryId: 'string' } },
      { name: 'memory_delete_bulk', desc: '批量删除', p: { agentId: 'string', memoryIds: { type: 'array', items: { type: 'string' } } } },
      { name: 'memory_clear', desc: '清空记忆', p: { agentId: 'string', keepCore: 'boolean' } },
      { name: 'memory_update', desc: '更新记忆', p: { agentId: 'string', memoryId: 'string', content: 'string' } },
      { name: 'memory_export', desc: '导出记忆', p: { agentId: 'string' } },
      { name: 'memory_import', desc: '导入记忆', p: { agentId: 'string', memories: { type: 'array' } } }
    ];

    tools.forEach(tool => {
      api.registerTool({
        name: tool.name, label: tool.name.replace('_', ' ').toUpperCase(), description: tool.desc,
        parameters: { type: 'object', properties: tool.p, required: Object.keys(tool.p) },
        async execute(_id: string, params: any) {
          try {
            let result;
            switch (tool.name) {
              case 'memory_list': result = plugin.listMemories(params.agentId, params.limit || 20); break;
              case 'memory_search': result = plugin.searchMemories(params.agentId, params.query); break;
              case 'memory_stats': result = plugin.getStats(params.agentId); break;
              case 'memory_get': result = plugin.getMemory(params.agentId, params.memoryId); break;
              case 'memory_delete': result = { success: plugin.deleteMemory(params.agentId, params.memoryId) }; break;
              case 'memory_delete_bulk': result = { deleted: plugin.deleteBulk(params.agentId, params.memoryIds) }; break;
              case 'memory_clear': result = { deleted: plugin.clearMemories(params.agentId, params.keepCore !== false) }; break;
              case 'memory_update': result = { success: plugin.updateMemory(params.agentId, params.memoryId, params.content) }; break;
              case 'memory_export': result = plugin.exportMemories(params.agentId); break;
              case 'memory_import': result = { imported: plugin.importMemories(params.agentId, params.memories) }; break;
            }
            return { content: [{ type: 'text', text: JSON.stringify(result) }] };
          } catch (err: any) { return { content: [{ type: 'text', text: 'Error: ' + String(err) }], isError: true }; }
        }
      });
    });

    // 钩子
    api.on('agent_end', async (e: any, ctx: any) => {
      const sessionKey = ctx.sessionKey || 'default';
      const messages = ctx.messages || [];
      if (DEFAULT_CONFIG.autoCapture && messages.length > 0) await plugin.store(sessionKey, messages);
    });

    api.onConversationTurn(async (messages: any[], sessionKey: string, _owner: string) => {
      const agentId = sessionKey || 'default';
      if (DEFAULT_CONFIG.autoCapture) await plugin.store(agentId, messages);
      if (DEFAULT_CONFIG.autoRecall) {
        const userMsg = messages.find((m: any) => m.role === 'user');
        if (userMsg && shouldRetrieve(userMsg.content || '', DEFAULT_CONFIG.adaptiveRetrieval)) {
          await plugin.recall(agentId, userMsg.content || '');
        }
      }
    });

    api.onDeactivate(() => plugin.close());
    const cfg = api.pluginConfig || {};
    log.info(`[algo-memory] 插件注册完成, 工具数: ${tools.length}, 每轮写入: ${cfg.capturePerTurn || 3}条, 三层晋升: ${cfg.tier?.enabled}`);
  }
};

export default algoMemoryPlugin;
