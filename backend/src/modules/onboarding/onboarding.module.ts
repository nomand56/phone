import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../infrastructure/database/database.module.js";
import { RedisModule } from "../../infrastructure/redis/redis.module.js";
import { AuthModule } from "../auth/auth.module.js";
import { ActivationController } from "./activation.controller.js";
import { ActivationService } from "./activation.service.js";
import { OnboardingController } from "./onboarding.controller.js";
import { OnboardingService } from "./onboarding.service.js";

@Module({
  imports: [AuthModule, DatabaseModule, RedisModule],
  controllers: [OnboardingController, ActivationController],
  providers: [OnboardingService, ActivationService],
})
export class OnboardingModule {}
