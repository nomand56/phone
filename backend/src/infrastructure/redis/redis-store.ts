import { Injectable, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { createClient } from "redis";
import { requiredEnv } from "../../config/env.js";

const incrementWithExpiry = `
  local count = redis.call('INCR', KEYS[1])
  if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
  return count
`;

@Injectable()
export class RedisStore implements OnModuleInit, OnModuleDestroy {
  private readonly client = createClient({
    url: requiredEnv("REDIS_URL"),
    disableOfflineQueue: true,
    socket: { connectTimeout: 2500, reconnectStrategy: (attempt) => Math.min(200 * (attempt + 1), 2000) },
  });

  onModuleInit(): void {
    this.client.on("error", () => console.error("Redis connection unavailable."));
    void this.client.connect().catch(() => undefined);
  }

  async ping(): Promise<void> {
    await this.client.ping();
  }

  async incrementCounter(key: string, seconds: number): Promise<unknown> {
    return this.client.eval(incrementWithExpiry, {
      keys: [key],
      arguments: [String(seconds)],
    });
  }

  onModuleDestroy(): void {
    if (this.client.isOpen) this.client.destroy();
  }
}
