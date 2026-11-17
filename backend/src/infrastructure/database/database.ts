import { Injectable, type OnModuleDestroy } from "@nestjs/common";
import { Pool, type PoolClient } from "pg";
import { requiredEnv } from "../../config/env.js";

@Injectable()
export class Database implements OnModuleDestroy {
  readonly pool = new Pool({
    connectionString: requiredEnv("DATABASE_URL"),
    connectionTimeoutMillis: 2500,
    statement_timeout: 5000,
  });

  constructor() {
    this.pool.on("error", () => console.error("Idle PostgreSQL connection lost."));
  }

  async transaction<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    let discard = false;
    try {
      await client.query("BEGIN");
      const result = await operation(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        discard = true;
      }
      throw error;
    } finally {
      client.release(discard);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
