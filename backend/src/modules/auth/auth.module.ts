import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../infrastructure/database/database.module.js";
import { RedisModule } from "../../infrastructure/redis/redis.module.js";
import { AuthController } from "./auth.controller.js";
import { AuthService } from "./auth.service.js";
import { SignupService } from "./signup.service.js";

@Module({
  imports: [DatabaseModule, RedisModule],
  controllers: [AuthController],
  providers: [AuthService, SignupService],
  exports: [AuthService],
})
export class AuthModule {}
