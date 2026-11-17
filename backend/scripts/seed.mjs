import { Client } from "pg";
import { hashPassword } from "../dist/modules/auth/password.js";

if (process.env.NODE_ENV === "production") throw new Error("Demo seed runs in development only.");
const connectionString = process.env.MIGRATION_DATABASE_URL;
const password = process.env.DEMO_PASSWORD;
if (!connectionString) throw new Error("MIGRATION_DATABASE_URL is required.");
if (!password || password.length < 14 || Buffer.byteLength(password, "utf8") > 1024) {
  throw new Error("Set DEMO_PASSWORD to a local password of at least 14 characters.");
}

const fixtures = [
  {
    userId: "46de76ac-6126-47a7-9e00-6b31f01e4fb8",
    tenantId: "e138d24c-2cf3-4cdb-9798-9af650949fbb",
    email: "owner@cedar-auto.example",
    name: "Cedar Auto Repair",
    timeZone: "America/Vancouver",
  },
  {
    userId: "1410a06f-3c01-4709-9c59-dd3e21f4b8a6",
    tenantId: "3255f87c-344b-40b3-aa4e-470642bb611d",
    email: "owner@harbour-garage.example",
    name: "Harbour Garage",
    timeZone: "America/Halifax",
  },
];

const client = new Client({ connectionString, connectionTimeoutMillis: 5000 });
await client.connect();
try {
  await client.query("BEGIN");
  for (const fixture of fixtures) {
    await client.query(
      `INSERT INTO users (id, email, password_hash, verified_at) VALUES ($1, $2, $3, now())
       ON CONFLICT (id) DO UPDATE SET password_hash = EXCLUDED.password_hash`,
      [fixture.userId, fixture.email, await hashPassword(password)],
    );
    await client.query(
      `INSERT INTO tenants (id, legal_name, display_name, country, time_zone)
       VALUES ($1, $2, $2, 'CA', $3) ON CONFLICT (id) DO NOTHING`,
      [fixture.tenantId, fixture.name, fixture.timeZone],
    );
    await client.query(
      `INSERT INTO tenant_memberships (tenant_id, user_id, role)
       VALUES ($1, $2, 'owner') ON CONFLICT (tenant_id, user_id) DO NOTHING`,
      [fixture.tenantId, fixture.userId],
    );
    await client.query("DELETE FROM sessions WHERE user_id = $1", [fixture.userId]);
  }
  await client.query("COMMIT");
  console.log("Seeded owner@cedar-auto.example and owner@harbour-garage.example.");
} finally {
  await client.end();
}
