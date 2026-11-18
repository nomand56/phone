import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { test } from "node:test";
import { setTimeout } from "node:timers/promises";
import { Client } from "pg";
import Stripe from "stripe";
import twilio from "twilio";
import { WebSocket } from "ws";
import { createApp } from "../dist/app.js";

test("email signup and receptionist setup resume and remain isolated by tenant", async () => {
  const { MIGRATION_DATABASE_URL, WEB_ORIGIN } = process.env;
  assert.ok(MIGRATION_DATABASE_URL && WEB_ORIGIN);
  process.env.AUTH_LOCAL_VERIFICATION = "true";
  process.env.ONBOARDING_SANDBOX = "true";
  const account = `AC${"a".repeat(32)}`;
  const voiceOrigin = "https://voice.example.test";
  const voiceToken = "fixture-voice-token";
  process.env.TWILIO_ACCOUNT_SID = account;
  process.env.TWILIO_AUTH_TOKEN = voiceToken;
  process.env.TWILIO_PUBLIC_ORIGIN = voiceOrigin;
  process.env.STRIPE_SECRET_KEY = "sk_test_fixture";
  process.env.STRIPE_PUBLISHABLE_KEY = "pk_test_fixture";
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_fixture";
  process.env.STRIPE_MONTHLY_PRICE_ID = "price_fixture_monthly";
  process.env.STRIPE_YEARLY_PRICE_ID = "price_fixture_yearly";
  const addresses = [`setup-${randomUUID()}@example.test`, `setup-${randomUUID()}@example.test`];
  const password = randomUUID();
  const admin = new Client({ connectionString: MIGRATION_DATABASE_URL });
  await admin.connect();
  let app;

  try {
    app = await createApp();
    await app.listen(0, "127.0.0.1");
    const base = await app.getUrl();
    let ready = false;
    for (let index = 0; index < 40 && !ready; index += 1) {
      ready = (await fetch(`${base}/health/ready`)).ok;
      if (!ready) await setTimeout(100);
    }
    assert.ok(ready, "PostgreSQL and Redis must be ready.");

    function request(path, method, body, cookie) {
      return fetch(`${base}/v1/${path}`, {
        method,
        headers: { Origin: WEB_ORIGIN, "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    }

    async function createOwner(email) {
      const start = await request("auth/signup", "POST", { email });
      assert.equal(start.status, 202);
      const { localVerificationUrl } = await start.json();
      const token = new URLSearchParams(new URL(localVerificationUrl).hash.slice(1)).get("token");
      assert.ok(token);
      const signIn = await request("auth/login", "POST", { email, password });
      assert.equal(signIn.status, 401);
      const verify = await request("auth/signup/verify", "POST", { token, password });
      assert.equal(verify.status, 204);
      const header = verify.headers.get("set-cookie");
      assert.match(header, /HttpOnly/i);
      const duplicate = await request("auth/signup/verify", "POST", { token, password });
      assert.equal(duplicate.status, 400);
      const retry = await request("auth/signup", "POST", { email });
      assert.deepEqual(await retry.json(), {});
      return header.split(";")[0];
    }

    assert.equal((await request("onboarding", "GET")).status, 401);
    const first = await createOwner(addresses[0]);
    const second = await createOwner(addresses[1]);
    const rules = { greeting: "Welcome to Cedar Test.", intake: "Please tell me your name and phone number.",
      fallback: "I can take a message for the team." };

    assert.equal((await request("onboarding/rules", "PATCH", rules, first)).status, 409);
    assert.equal((await request("onboarding/website", "POST", { website: "http://127.1" }, first)).status, 400);
    const profile = { name: "Cedar Test", website: "cedar.example", knowledge: "Opening hours are Monday to Friday." };
    const profileResult = await request("onboarding/profile", "PATCH", profile, first);
    assert.equal(profileResult.status, 200);
    assert.equal((await profileResult.json()).profile.website, "https://cedar.example/");
    assert.equal((await request("onboarding/rules", "PATCH", rules, first)).status, 200);
    assert.equal((await request("onboarding/phone", "PATCH", { mode: "new", areaCode: "604" }, first)).status, 409);
    const preview = await request("onboarding/preview", "POST", { message: "What are your opening hours?" }, first);
    assert.equal(preview.status, 200);
    assert.equal((await preview.json()).reply, profile.knowledge);

    const phone = { mode: "existing", existingNumber: "+16045550100", forwarding: "after_hours" };
    assert.equal((await request("onboarding/phone", "PATCH", phone, first)).status, 200);
    const resumed = await (await request("onboarding", "GET", undefined, first)).json();
    assert.deepEqual(resumed.phone, phone);
    assert.ok(resumed.previewedAt);
    const otherTenant = await (await request("onboarding", "GET", undefined, second)).json();
    assert.equal(otherTenant.name, "New business");
    assert.equal(otherTenant.profile, null);
    assert.equal(otherTenant.phone, null);

    const changed = await request("onboarding/rules", "PATCH", { ...rules, greeting: "Hello from Cedar." }, first);
    assert.equal((await changed.json()).previewedAt, null);
    assert.equal((await request("onboarding/phone", "PATCH", phone, first)).status, 409);

    assert.equal((await request("onboarding/numbers", "GET", undefined, first)).status, 409);
    assert.equal((await request("onboarding/checkout", "POST", { cadence: "monthly" }, first)).status, 409);
    for (const [field, value] of [["answer", { kind: "myself" }], ["missed", { kind: "voicemail" }],
      ["capabilities", ["messages", "leads", "questions"]]]) {
      assert.equal((await request("onboarding/discovery", "PATCH", { field, value }, first)).status, 200);
    }
    assert.equal((await request("onboarding/train/manual", "POST", profile, first)).status, 200);
    assert.equal((await request("onboarding/voice", "PATCH", { voice: "eric", skipped: true }, first)).status, 200);
    const inventory = await (await request("onboarding/numbers?areaCode=604", "GET", undefined, first)).json();
    assert.equal(inventory.sandbox, true);
    assert.equal(inventory.options.length, 4);
    assert.equal((await request("onboarding/number", "PATCH", { number: "+16045550199" }, first)).status, 409);
    assert.equal((await request("onboarding/number", "PATCH", { number: inventory.options[0].number }, first)).status, 200);
    const checkout = await request("onboarding/checkout", "POST", { cadence: "yearly" }, first);
    assert.deepEqual(await checkout.json(), { mode: "sandbox" });
    const complete = await (await request("onboarding", "GET", undefined, first)).json();
    assert.ok(complete.sandboxCompletedAt);
    assert.equal(complete.cadence, "yearly");
    assert.deepEqual(await (await request("onboarding/activation", "GET", undefined, first)).json(), { activation: null });
    assert.deepEqual((await (await request("onboarding", "GET", undefined, second)).json()).discovery, {});
    process.env.ONBOARDING_SANDBOX = "false";
    const liveDraft = await (await request("onboarding", "GET", undefined, first)).json();
    assert.equal(liveDraft.selectedNumber, null);
    assert.equal(liveDraft.sandboxCompletedAt, null);
    process.env.ONBOARDING_SANDBOX = "true";

    const stripeBody = JSON.stringify({ type: "ping", data: { object: {} } });
    const stripeSignature = new Stripe(process.env.STRIPE_SECRET_KEY).webhooks.generateTestHeaderString({
      payload: stripeBody, secret: process.env.STRIPE_WEBHOOK_SECRET,
    });
    const stripeWebhook = (signature) => fetch(`${base}/webhooks/stripe`, {
      method: "POST", headers: { "Content-Type": "application/json", "Stripe-Signature": signature }, body: stripeBody,
    });
    assert.equal((await stripeWebhook("bad signature")).status, 400);
    assert.equal((await stripeWebhook(stripeSignature)).status, 200);

    const { rows: [owner] } = await admin.query(
      "SELECT m.tenant_id FROM tenant_memberships m JOIN users u ON u.id = m.user_id WHERE u.email = $1", [addresses[0]],
    );
    const liveNumber = "+12365550119";
    const providerCall = `CA${randomUUID().replaceAll("-", "")}`;
    await admin.query(
      `INSERT INTO receptionist_activation (tenant_id, number, cadence, stripe_status, state, twilio_sid)
       VALUES ($1,$2,'monthly','trialing','active',$3)`, [owner.tenant_id, liveNumber, `PN${randomUUID()}`],
    );
    const params = { AccountSid: account, CallSid: providerCall, To: liveNumber, From: "+16045550101" };
    function twilioEvent(path, fields, signed = true) {
      return fetch(`${base}${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "X-Twilio-Signature": signed ? twilio.getExpectedTwilioSignature(voiceToken, voiceOrigin + path, fields) : "invalid",
        },
        body: new URLSearchParams(fields),
      });
    }

    assert.equal((await twilioEvent("/webhooks/twilio/voice", params, false)).status, 403);
    const inbound = await twilioEvent("/webhooks/twilio/voice", params);
    assert.equal(inbound.status, 200);
    assert.match(await inbound.text(), /Press 1 to continue/);
    const consent = await twilioEvent("/webhooks/twilio/consent", { ...params, Digits: "1" });
    assert.equal(consent.status, 200);
    assert.match(await consent.text(), /ConversationRelay/);
    const ws = new WebSocket(`${base.replace(/^http:/, "ws:")}/voice/sessions`, { headers: {
      "X-Twilio-Signature": twilio.getExpectedTwilioSignature(voiceToken, `${voiceOrigin}/voice/sessions`, {}),
    } });
    try {
      await once(ws, "open", { signal: AbortSignal.timeout(4000) });
      ws.send(JSON.stringify({ type: "setup", callSid: providerCall }));
      async function ask(voicePrompt) {
        const reply = once(ws, "message", { signal: AbortSignal.timeout(4000) });
        ws.send(JSON.stringify({ type: "prompt", voicePrompt, last: true }));
        return JSON.parse((await reply)[0].toString()).token;
      }
      assert.match(await ask("I'd like a callback"), /callback number/);
      assert.match(await ask("Please call Taylor about a repair."), /message was saved/);
    } finally { ws.terminate(); }
    const messages = await (await request("onboarding/messages", "GET", undefined, first)).json();
    assert.equal(messages.length, 1);
    assert.equal(messages[0].message, "Please call Taylor about a repair.");
    assert.deepEqual(await (await request("onboarding/messages", "GET", undefined, second)).json(), []);
  } finally {
    try {
      await app?.close();
      const { rows } = await admin.query(
        `SELECT t.tenant_id, u.id FROM users u JOIN tenant_memberships t ON t.user_id = u.id
         WHERE u.email = ANY($1::text[])`, [addresses],
      );
      await admin.query("DELETE FROM tenant_memberships WHERE user_id = ANY($1::uuid[])", [rows.map((row) => row.id)]);
      await admin.query("DELETE FROM tenants WHERE id = ANY($1::uuid[])", [rows.map((row) => row.tenant_id)]);
      await admin.query("DELETE FROM users WHERE email = ANY($1::text[])", [addresses]);
      await admin.query("DELETE FROM signup_tokens WHERE email = ANY($1::text[])", [addresses]);
    } finally {
      await admin.end();
    }
  }
});
