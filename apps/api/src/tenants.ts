import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  Patch,
  Req,
} from "@nestjs/common";
import type { Request } from "express";
import type { PoolClient } from "pg";
import { assertWebOrigin, AuthService } from "./auth.js";
import { Database } from "./database.js";

interface Tenant {
  id: string;
  displayName: string;
  country: string;
  timeZone: string;
  status: string;
}

interface Membership {
  role: "owner" | "admin" | "staff";
}

const tenantFields = 'id, display_name AS "displayName", country, time_zone AS "timeZone", status';

function parseSettings(body: unknown) {
  if (!body || typeof body !== "object" || !("displayName" in body) || !("timeZone" in body)
    || Object.keys(body).some((key) => key !== "displayName" && key !== "timeZone")) {
    throw new BadRequestException("Provide a display name and time zone.");
  }
  const displayName = typeof body.displayName === "string" ? body.displayName.trim() : "";
  const timeZone = typeof body.timeZone === "string" ? body.timeZone.trim() : "";
  if (!displayName || displayName.length > 120 || /[\p{Cc}\p{Cf}]/u.test(displayName)) {
    throw new BadRequestException("Enter a business name between 1 and 120 characters.");
  }
  if (!timeZone || timeZone.length > 80 || !/^[A-Za-z][A-Za-z_+-]*(?:\/[A-Za-z0-9_+-]+)*$/.test(timeZone)) {
    throw new BadRequestException("Enter a valid time zone.");
  }
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone });
  } catch {
    throw new BadRequestException("Enter a valid time zone.");
  }
  return { displayName, timeZone };
}

@Controller("v1/tenants/current")
export class TenantsController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(Database) private readonly database: Database,
  ) {}

  @Get()
  async current(@Req() request: Request): Promise<Tenant> {
    return this.withTenant(request, async (client, tenantId) => {
      const { rows: [tenant] } = await client.query<Tenant>(
        `SELECT ${tenantFields} FROM tenants WHERE id = $1 AND status <> 'closed'`,
        [tenantId],
      );
      if (!tenant) throw new ForbiddenException("Workspace access is unavailable.");
      return tenant;
    });
  }

  @Patch()
  async update(@Req() request: Request, @Body() body: unknown): Promise<Tenant> {
    assertWebOrigin(request);
    const { displayName, timeZone } = parseSettings(body);
    return this.withTenant(request, async (client, tenantId, membership) => {
      if (membership.role !== "owner") throw new ForbiddenException("You cannot edit this workspace.");
      const { rows: [tenant] } = await client.query<Tenant>(
        `UPDATE tenants SET display_name = $2, time_zone = $3
         WHERE id = $1 AND status NOT IN ('suspended', 'closed') RETURNING ${tenantFields}`,
        [tenantId, displayName, timeZone],
      );
      if (!tenant) throw new ForbiddenException("You cannot edit this workspace.");
      return tenant;
    });
  }

  private async withTenant<T>(
    request: Request,
    operation: (client: PoolClient, tenantId: string, membership: Membership) => Promise<T>,
  ): Promise<T> {
    const session = await this.auth.requireSession(request);
    return this.database.transaction(async (client) => {
      await client.query("SELECT set_config('app.user_id', $1, true), set_config('app.tenant_id', $2, true)",
        [session.user_id, session.tenant_id]);
      const { rows: [membership] } = await client.query<Membership>(
        `SELECT role FROM tenant_memberships WHERE tenant_id = $1 AND user_id = $2 AND revoked_at IS NULL`,
        [session.tenant_id, session.user_id],
      );
      if (!membership) throw new ForbiddenException("Workspace access is unavailable.");
      return operation(client, session.tenant_id, membership);
    });
  }
}
