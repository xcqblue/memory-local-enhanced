// 类型声明文件 - 解决模块导入类型问题
declare module 'lru-cache' {
  export default class LRUCache<K, V> {
    constructor(options?: { max?: number; ttl?: number });
    get(key: K): V | undefined;
    set(key: K, value: V): void;
    delete(key: K): boolean;
    has(key: K): boolean;
    clear(): void;
  }
}

declare module 'better-sqlite3' {
  interface Database {
    prepare(sql: string): Statement;
    exec(sql: string): void;
    pragma(pragma: string): any;
    close(): void;
  }
  interface Statement {
    run(...params: any[]): { changes: number };
    get(...params: any[]): any;
    all(...params: any[]): any[];
  }
  export default class Database {
    constructor(filename: string);
  }
}
