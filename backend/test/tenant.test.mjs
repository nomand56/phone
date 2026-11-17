import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { setTimeout } from "node:timers/promises";
import { Client } from "pg";
import { createApp } from "../dist/app.js";
import { hashPassword } from "../dist/modules/auth/password.js";

test("authenticated workspace reads and writes stay isolated between two tenants", async () => {
  const { DATABASE_URL, MIGRATION_DATABASE_URL, WEB_ORIGIN } = process.env;
  assert.ok(DATABASE_URL && MIGRATION_DATABASE_URL && WEB_ORIGIN, "Configure test service URLs and run the migration first.");

  const owner = () => ({
    id: randomUUID(),
    tenantId: randomUUID(),
    email: `owner-${randomUUID()}@example.test`,
  });
  const first = owner();
  const second = owner();
  const password = randomUUID();
  const hash = await hashPassword(password);
  const admin = new Client({ connectionString: MIGRATION_DATABASE_URL });
  const runtime = new Client({ connectionString: DATABASE_URL });
  await admin.connect();
  let app;

  try {
    await runtime.connect();
    const { rows: [role] } = await runtime.query(
      "SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user",
    );
    assert.deepEqual(role, { rolname: "phone_app", rolsuper: false, rolbypassrls: false });

    for (const [fixture, name] of [[first, "Cedar Test"], [second, "Harbour Test"]]) {
      await admin.query(
        "INSERT INTO users (id, email, password_hash, verified_at) VALUES ($1, $2, $3, now())",
        [fixture.id, fixture.email, hash],
      );
      await admin.query(
        `INSERT INTO tenants (id, legal_name, display_name, country, time_zone)
         VALUES ($1, $2, $2, 'CA', 'America/Vancouver')`,
        [fixture.tenantId, name],
      );
      await admin.query(
        "INSERT INTO tenant_memberships (tenant_id, user_id, role) VALUES ($1, $2, 'owner')",
        [fixture.tenantId, fixture.id],
      );
    }

    app = await createApp();
    await app.listen(0, "127.0.0.1");
    const base = await app.getUrl();
    const url = `${base}/v1/tenants/current`;

    let ready = false;
    for (let attempt = 0; attempt < 40 && !ready; attempt += 1) {
      ready = (await fetch(`${base}/health/ready`)).ok;
      if (!ready) await setTimeout(100);
    }
    assert.ok(ready, "PostgreSQL and Redis must be ready.");

    const login = async (fixture) => {
      const response = await fetch(`${base}/v1/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: WEB_ORIGIN },
        body: JSON.stringify({ email: fixture.email.toUpperCase(), password }),
      });
      assert.equal(response.status, 204);
      const cookie = response.headers.get("set-cookie");
      assert.match(cookie, /HttpOnly/i);
      assert.match(cookie, /SameSite=Lax/i);
      return cookie.split(";")[0];
    };

    assert.equal((await fetch(url)).status, 401);
    const cookieA = await login(first);
    const cookieB = await login(second);
    const readA = await fetch(url, { headers: { Cookie: cookieA, "X-Tenant-Id": second.tenantId } });
    assert.equal(readA.headers.get("Cache-Control"), "no-store");
    assert.equal((await readA.json()).id, first.tenantId);
    assert.equal((await (await fetch(url, { headers: { Cookie: cookieB } })).json()).id, second.tenantId);

    const updates = { displayName: "Cedar Updated", timeZone: "America/Halifax" };
    const update = (body, origin = WEB_ORIGIN) => fetch(url, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookieA,
        Origin: origin,
        "X-Tenant-Id": second.tenantId,
      },
      body: JSON.stringify(body),
    });
    assert.equal((await update(updates, "https://unrelated.example")).status, 403);
    assert.equal((await update({ ...updates, tenantId: second.tenantId })).status, 400);
    assert.equal((await update({ ...updates, timeZone: "Mars/Olympus" })).status, 400);
    const changed = await update(updates);
    assert.equal(changed.status, 200);
    assert.deepEqual(await changed.json(), {
      id: first.tenantId, country: "CA", status: "draft", ...updates,
    });
    const untouched = await (await fetch(url, { headers: { Cookie: cookieB } })).json();
    assert.equal(untouched.displayName, "Harbour Test");

    assert.equal((await runtime.query("SELECT id FROM tenants")).rowCount, 0);
    await runtime.query("BEGIN");
    await runtime.query("SELECT set_config('app.user_id', $1, true), set_config('app.tenant_id', $2, true)",
      [first.id, second.tenantId]);
    assert.equal((await runtime.query("SELECT id FROM tenants WHERE id = $1", [second.tenantId])).rowCount, 0);
    assert.equal((await runtime.query(
      "UPDATE tenants SET display_name = 'Cross-tenant write' WHERE id = $1", [second.tenantId],
    )).rowCount, 0);
    await runtime.query("COMMIT");
    assert.equal((await runtime.query("SELECT id FROM tenants")).rowCount, 0);

    const logout = await fetch(`${base}/v1/auth/logout`, {
      method: "POST", headers: { Cookie: cookieA, Origin: WEB_ORIGIN },
    });
    assert.equal(logout.status, 204);
    assert.equal((await fetch(url, { headers: { Cookie: cookieA } })).status, 401);
    assert.equal((await fetch(url, { headers: { Cookie: cookieB } })).status, 200);

    await admin.query("UPDATE tenant_memberships SET role = 'staff' WHERE tenant_id = $1 AND user_id = $2",
      [second.tenantId, second.id]);
    const staffWrite = await fetch(url, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: cookieB, Origin: WEB_ORIGIN },
      body: JSON.stringify(updates),
    });
    assert.equal(staffWrite.status, 403);
    await admin.query("UPDATE tenant_memberships SET revoked_at = now() WHERE tenant_id = $1 AND user_id = $2",
      [second.tenantId, second.id]);
    assert.equal((await fetch(url, { headers: { Cookie: cookieB } })).status, 403);
  } finally {
    try {
      await app?.close();
      await admin.query("DELETE FROM tenant_memberships WHERE user_id = ANY($1::uuid[])", [[first.id, second.id]]);
      await admin.query("DELETE FROM tenants WHERE id = ANY($1::uuid[])", [[first.tenantId, second.tenantId]]);
      await admin.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [[first.id, second.id]]);
    } finally {
      await Promise.all([admin.end(), runtime.end()]);
    }
  }
});
