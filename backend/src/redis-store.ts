import {
  HttpException,
  HttpStatus,
  Injectable,
  type OnModuleDestroy,
  type OnModuleInit,
  ServiceUnavailableException,
} from "@nestjs/common";
import { createHash } from "node:crypto";
import { createClient } from "redis";
import { requiredEnv } from "./config.js";

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

  async limitLogin(ip: string, email: string): Promise<void> {
    await this.consume("source", ip, 100, 60);
    await this.consume("account", email, 10, 900);
  }

  private async consume(scope: string, identifier: string, limit: number, seconds: number) {
    const digest = createHash("sha256").update(identifier).digest("hex");
    let attempts: unknown;
    try {
      attempts = await this.client.eval(incrementWithExpiry, {
        keys: [`phone:login:${scope}:${digest}`],
        arguments: [String(seconds)],
      });
    } catch {
      throw new ServiceUnavailableException("Sign-in is temporarily unavailable.");
    }

    if (typeof attempts !== "number" || attempts > limit) {
      throw new HttpException("Too many sign-in attempts. Try again later.", HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  onModuleDestroy(): void {
    if (this.client.isOpen) this.client.destroy();
  }
}
