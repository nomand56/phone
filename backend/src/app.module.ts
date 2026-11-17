import { Module } from "@nestjs/common";
import { AuthModule } from "./modules/auth/auth.module.js";
import { HealthModule } from "./modules/health/health.module.js";
import { TenantsModule } from "./modules/tenants/tenants.module.js";

@Module({
  imports: [AuthModule, TenantsModule, HealthModule],
})
export class AppModule {}
