import { Controller, Get, Inject, ServiceUnavailableException } from "@nestjs/common";
import { Database } from "../../infrastructure/database/database.js";
import { RedisStore } from "../../infrastructure/redis/redis-store.js";

@Controller("health")
export class HealthController {
  constructor(
    @Inject(Database) private readonly database: Database,
    @Inject(RedisStore) private readonly redis: RedisStore,
  ) {}

  @Get("live")
  liveness() {
    return { status: "ok" };
  }

  @Get("ready")
  async readiness() {
    try {
      await Promise.all([this.database.pool.query("SELECT 1 FROM sessions LIMIT 0"), this.redis.ping()]);
    } catch {
      throw new ServiceUnavailableException("Service dependencies are unavailable.");
    }
    return { status: "ok" };
  }
}
