import Redis from "ioredis";

// ==============================
// 配置
// ==============================
const MAX_RETRY = 2;
const redisEnabled = true;

// ==============================
// 内存 KV（降级备用）
// ==============================
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

// ==============================
// Redis 客户端
// ==============================
let redisClient: Redis | null = null;
let redisFailed = false;

function getRedisClient(): Redis | null {
  if (!redisEnabled) return null;
  if (redisFailed) return null;

  if (redisClient && redisClient.status !== "end") {
    return redisClient;
  }

  try {
    redisClient = new Redis({
      host: process.env.REDIS_HOST || "localhost",
      port: parseInt(process.env.REDIS_PORT || "6379"),
      password: process.env.REDIS_PASSWORD || undefined,
      db: parseInt(process.env.REDIS_DB || "0"),

      lazyConnect: true,
      maxRetriesPerRequest: MAX_RETRY,
      enableOfflineQueue: false,
      connectTimeout: 1500,

      retryStrategy(times) {
        if (times > MAX_RETRY) {
          redisFailed = true;
          console.warn("[KV] Redis 重试超限，标记为不可用");
          return null;
        }
        return Math.min(times * 80, 1000);
      },
    });

    redisClient.on("error", (err) => {
      redisFailed = true;
      console.warn("[KV] Redis 异常:", err.message);
    });

    redisClient.on("close", () => {
      redisFailed = true;
    });

    redisClient.on("connect", () => {
      console.log("[KV] Redis 连接成功");
    });

    return redisClient;
  } catch (err: any) {
    redisFailed = true;
    console.warn("[KV] Redis 初始化失败:", err.message);
    return null;
  }
}

// ==============================
// 自动容错 KV + 完整日志
// ==============================
export const kv = {
  async get<T>(key: string): Promise<T | null> {
    const client = getRedisClient();
    if (!client) {
      console.debug(`[KV] 降级内存 GET ${key}`);
      return memoryKV.get(key);
    }

    try {
      const data = await client.get(key);
      const result = data ? JSON.parse(data) : null;
      console.log(`[KV] Redis GET ${key} | ${result ? '命中' : '不存在'}`);
      return result;
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
      await client.set(key, JSON.stringify(value), "EX", exSeconds);
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