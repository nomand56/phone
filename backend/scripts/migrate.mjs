import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { Client } from "pg";

const connectionString = process.env.MIGRATION_DATABASE_URL;
if (!connectionString) throw new Error("MIGRATION_DATABASE_URL is required.");
const directory = new URL("../database/migrations/", import.meta.url);
const files = (await readdir(directory)).filter((name) => /^\d+_.+\.sql$/.test(name)).sort();
const client = new Client({ connectionString, connectionTimeoutMillis: 5000 });

await client.connect();
try {
  await client.query("BEGIN");
  await client.query("SELECT pg_advisory_xact_lock(355216831)");
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename text PRIMARY KEY,
      checksum text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  const appliedFiles = [];
  for (const file of files) {
    const sql = await readFile(new URL(file, directory), "utf8");
    const checksum = createHash("sha256").update(sql.replaceAll("\r\n", "\n")).digest("hex");
    const { rows: [previous] } = await client.query(
      "SELECT checksum FROM schema_migrations WHERE filename = $1", [file],
    );
    if (previous) {
      if (previous.checksum !== checksum) throw new Error(`Applied migration was edited: ${file}`);
      continue;
    }
    await client.query(sql);
    await client.query("INSERT INTO schema_migrations (filename, checksum) VALUES ($1, $2)", [file, checksum]);
    appliedFiles.push(file);
  }
  await client.query("COMMIT");
  for (const file of appliedFiles) console.log(`Applied ${file}`);
} finally {
  await client.end();
}
