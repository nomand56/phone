import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../infrastructure/database/database.module.js";
import { AuthModule } from "../auth/auth.module.js";
import { TenantsController } from "./tenants.controller.js";
import { TenantsService } from "./tenants.service.js";

@Module({
  imports: [AuthModule, DatabaseModule],
  controllers: [TenantsController],
  providers: [TenantsService],
})
export class TenantsModule {}
