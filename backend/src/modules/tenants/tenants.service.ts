import { ForbiddenException, Inject, Injectable } from "@nestjs/common";
import type { PoolClient } from "pg";
import { Database } from "../../infrastructure/database/database.js";
import type { Session } from "../auth/session.js";

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

@Injectable()
export class TenantsService {
  constructor(@Inject(Database) private readonly database: Database) {}

  async current(session: Session): Promise<Tenant> {
    return this.withTenant(session, async (client) => {
      const { rows: [tenant] } = await client.query<Tenant>(
        `SELECT ${tenantFields} FROM tenants WHERE id = $1 AND status <> 'closed'`,
        [session.tenant_id],
      );
      if (!tenant) throw new ForbiddenException("Workspace access is unavailable.");
      return tenant;
    });
  }

  async update(session: Session, { displayName, timeZone }: { displayName: string; timeZone: string }): Promise<Tenant> {
    return this.withTenant(session, async (client, membership) => {
      if (membership.role !== "owner") throw new ForbiddenException("You cannot edit this workspace.");
      const { rows: [tenant] } = await client.query<Tenant>(
        `UPDATE tenants SET display_name = $2, time_zone = $3
         WHERE id = $1 AND status NOT IN ('suspended', 'closed') RETURNING ${tenantFields}`,
        [session.tenant_id, displayName, timeZone],
      );
      if (!tenant) throw new ForbiddenException("You cannot edit this workspace.");
      return tenant;
    });
  }

  private async withTenant<T>(
    session: Session,
    operation: (client: PoolClient, membership: Membership) => Promise<T>,
  ): Promise<T> {
    return this.database.transaction(async (client) => {
      await client.query("SELECT set_config('app.user_id', $1, true), set_config('app.tenant_id', $2, true)",
        [session.user_id, session.tenant_id]);
      const { rows: [membership] } = await client.query<Membership>(
        `SELECT role FROM tenant_memberships WHERE tenant_id = $1 AND user_id = $2 AND revoked_at IS NULL`,
        [session.tenant_id, session.user_id],
      );
      if (!membership) throw new ForbiddenException("Workspace access is unavailable.");
      return operation(client, membership);
    });
  }
}
