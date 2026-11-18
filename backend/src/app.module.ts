import { Module } from "@nestjs/common";
import { AuthModule } from "./modules/auth/auth.module.js";
import { HealthModule } from "./modules/health/health.module.js";
import { OnboardingModule } from "./modules/onboarding/onboarding.module.js";
import { TenantsModule } from "./modules/tenants/tenants.module.js";
import { VoiceModule } from "./modules/voice/voice.module.js";

@Module({
  imports: [AuthModule, TenantsModule, HealthModule, OnboardingModule, VoiceModule],
})
export class AppModule {}
