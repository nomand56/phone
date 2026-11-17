import "reflect-metadata";
import {
  Controller,
  Get,
  Module,
  ServiceUnavailableException,
} from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { type NextFunction, type Request, type Response, json } from "express";
import { AuthController, AuthService } from "./auth.js";
import { webOrigin } from "./config.js";
import { Database } from "./database.js";
import { RedisStore } from "./redis-store.js";
import { TenantsController } from "./tenants.js";

@Controller("health")
class HealthController {
  constructor(private readonly database: Database, private readonly redis: RedisStore) {}

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

@Module({
  controllers: [HealthController, AuthController, TenantsController],
  providers: [Database, RedisStore, AuthService],
})
class AppModule {}

export async function createApp(): Promise<NestExpressApplication> {
  webOrigin();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });
  app.disable("x-powered-by");
  app.use((_request: Request, response: Response, next: NextFunction) => {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    next();
  });
  app.use(json({ limit: "8kb" }));
  return app;
}
