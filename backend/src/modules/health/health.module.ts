import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../infrastructure/database/database.module.js";
import { RedisModule } from "../../infrastructure/redis/redis.module.js";
import { HealthController } from "./health.controller.js";

@Module({
  imports: [DatabaseModule, RedisModule],
  controllers: [HealthController],
})
export class HealthModule {}
