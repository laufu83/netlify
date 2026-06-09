import { Redis } from '@upstash/redis';
const MAX_RETRY = 2;
const redisEnabled = true;

const memoryStore = new Map<string, { value: any; expires: number }>();
setInterval(() => {
  const now = Date.now();
  for (const [key, item] of memoryStore) {
    if (item.expires && item.expires < now) {
      memoryStore.delete(key);
    }
  }
}, 3000);

const memoryKV = {
  async get<T>(key: string): Promise<T | null> {
    try {
      const item = memoryStore.get(key);
      if (!item) return null;
      if (item.expires && item.expires < Date.now()) {
        memoryStore.delete(key);
        return null;
      }
      return item.value;
    } catch {
      return null;
    }
  },

  async set(key: string, value: any, exSeconds = 600): Promise<void> {
    try {
      memoryStore.set(key, {
        value,
        expires: exSeconds ? Date.now() + exSeconds * 1000 : 0,
      });
    } catch {}
  },

  async del(key: string): Promise<void> {
    try {
      memoryStore.delete(key);
    } catch {}
  },

  async incr(key: string): Promise<number> {
    try {
      const val = ((await this.get<number>(key)) ?? 0) + 1;
      await this.set(key, val, 60);
      return val;
    } catch {
      return 0;
    }
  },
};

let redisClient: Redis | null = null;
let redisFailed = false;

function getRedisClient(): Redis | null {
  if (!redisEnabled) return null;
  if (redisFailed) return null;

  if (redisClient) return redisClient;

  try {
    redisClient = new Redis({
      url: process.env.UPSTASH_REDIS_URL!,
      token: process.env.UPSTASH_REDIS_TOKEN!,
    });
    console.log("[KV] Upstash Redis 连接成功");
    return redisClient;
  } catch (err: any) {
    redisFailed = true;
    console.warn("[KV] Redis 初始化失败:", err.message);
    return null;
  }
}

export const kv = {
  async get<T>(key: string): Promise<T | null> {
    const client = getRedisClient();
    if (!client) {
      console.debug(`[KV] 降级内存 GET ${key}`);
      return memoryKV.get(key);
    }

    try {
      const result = await client.get<T>(key);
      console.log(`[KV] Redis GET ${key} | ${result ? '命中' : '不存在'}`);
      return result ?? null;
    } catch (err: any) {
      redisFailed = true;
      console.warn(`[KV] Redis GET 失败，降级内存 | key: ${key} | err: ${err.message}`);
      return memoryKV.get(key);
    }
  },

  async set(key: string, value: any, exSeconds = 600): Promise<void> {
    const client = getRedisClient();
    if (!client) {
      console.debug(`[KV] 降级内存 SET ${key}`);
      return memoryKV.set(key, value, exSeconds);
    }

    try {
      await client.set(key, value, { ex: exSeconds });
      console.log(`[KV] Redis SET ${key} | 过期: ${exSeconds}s`);
    } catch (err: any) {
      redisFailed = true;
      console.warn(`[KV] Redis SET 失败，降级内存 | key: ${key} | err: ${err.message}`);
      await memoryKV.set(key, value, exSeconds);
    }
  },

  async del(key: string): Promise<void> {
    const client = getRedisClient();
    if (!client) {
      console.debug(`[KV] 降级内存 DEL ${key}`);
      return memoryKV.del(key);
    }

    try {
      await client.del(key);
      console.log(`[KV] Redis DEL ${key}`);
    } catch (err: any) {
      redisFailed = true;
      console.warn(`[KV] Redis DEL 失败，降级内存 | key: ${key} | err: ${err.message}`);
      await memoryKV.del(key);
    }
  },

  async incr(key: string): Promise<number> {
    const client = getRedisClient();
    if (!client) {
      console.debug(`[KV] 降级内存 INCR ${key}`);
      return memoryKV.incr(key);
    }

    try {
      const val = await client.incr(key);
      console.log(`[KV] Redis INCR ${key} = ${val}`);
      return val;
    } catch (err: any) {
      redisFailed = true;
      console.warn(`[KV] Redis INCR 失败，降级内存 | key: ${key} | err: ${err.message}`);
      return memoryKV.incr(key);
    }
  },
};