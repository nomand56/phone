import { BadRequestException, ConflictException, Inject, Injectable, ServiceUnavailableException } from "@nestjs/common";
import Stripe from "stripe";
import { webOrigin } from "../../config/env.js";
import { Database } from "../../infrastructure/database/database.js";
import type { Session } from "../auth/session.js";
import type { Cadence } from "./journey-input.js";
import { numberOptions, rentNumber } from "./number-provider.js";
import { OnboardingService } from "./onboarding.service.js";
import { sandboxEnabled, stripeConfig, twilioConfig } from "./provider-config.js";

interface ActivationRecord {
  tenant_id: string;
  attempt_id: string;
  number: string;
  cadence: Cadence;
  stripe_checkout_id: string | null;
  stripe_subscription_id: string | null;
  stripe_status: string;
  state: "checkout" | "provisioning" | "active" | "unavailable";
  twilio_sid: string | null;
  retry_at: Date | null;
}

const entitled = (status: string) => status === "trialing" || status === "active";
type Plan = { cadence: Cadence; amount: number; currency: string };

@Injectable()
export class ActivationService {
  constructor(
    @Inject(Database) private readonly database: Database,
    @Inject(OnboardingService) private readonly onboarding: OnboardingService,
  ) {}

  async numbers(session: Session, area: string) {
    const setup = await this.onboarding.read(session);
    if (!setup.voiceStatus) throw new ConflictException("Finish or skip the voice preview first.");
    await this.onboarding.limit(session, "number-search", 25);
    return { sandbox: sandboxEnabled(), options: await numberOptions(area) };
  }

  async selectNumber(session: Session, number: string) {
    const setup = await this.onboarding.read(session);
    if (!setup.voiceStatus) throw new ConflictException("Finish or skip the voice preview first.");
    await this.onboarding.limit(session, "number-selection", 20);
    if (!/^\+1[2-9]\d{2}[2-9]\d{6}$/.test(number) || !(await numberOptions("", number)).length) {
      throw new ConflictException("That number is no longer available. Please choose another one.");
    }
    await this.onboarding.withOwner(session, async (client) => {
      const existing = await client.query<ActivationRecord>("SELECT * FROM receptionist_activation WHERE tenant_id = $1", [session.tenant_id]);
      if (existing.rowCount && existing.rows[0].number !== number && existing.rows[0].state !== "unavailable") {
        throw new ConflictException("This workspace already has a number tied to a checkout.");
      }
      if (existing.rows[0]?.state === "unavailable") {
        await client.query(
          "UPDATE receptionist_activation SET number = $2, state = 'provisioning', retry_at = NULL WHERE tenant_id = $1",
          [session.tenant_id, number],
        );
      }
      const result = await client.query(
        `UPDATE receptionist_setup SET selected_number = $2,
           sandbox_completed_at = CASE WHEN $3::boolean THEN sandbox_completed_at ELSE NULL END,
           checkout_cadence = CASE WHEN $3::boolean THEN checkout_cadence ELSE NULL END, updated_at = now()
         WHERE tenant_id = $1 AND voice_status IS NOT NULL AND (NOT $3::boolean OR sandbox_completed_at IS NULL)`,
        [session.tenant_id, number, sandboxEnabled()],
      );
      if (!result.rowCount) throw new ConflictException("Finish the voice preview before choosing a number.");
    });
    return this.onboarding.read(session);
  }

  async plans(session: Session): Promise<{ sandbox: boolean; plans: Plan[] }> {
    const setup = await this.onboarding.read(session);
    if (!setup.selectedNumber) throw new ConflictException("Choose a number first.");
    if (sandboxEnabled()) return {
      sandbox: true, plans: [{ cadence: "monthly", amount: 19900, currency: "usd" }, { cadence: "yearly", amount: 199000, currency: "usd" }],
    };
    const [stripe, config] = this.stripe();
    const entries = [["monthly", config.monthly], ["yearly", config.yearly]] as const;
    const plans = await Promise.all(entries.map(async ([cadence, id]) => {
      const price = await stripe.prices.retrieve(id);
      if (!price.active || price.unit_amount === null || price.unit_amount <= 0
        || price.recurring?.interval !== (cadence === "monthly" ? "month" : "year")
        || price.recurring.interval_count !== 1) throw new ServiceUnavailableException("The subscription prices require configuration.");
      return { cadence, amount: price.unit_amount, currency: price.currency };
    }));
    return { sandbox: false, plans };
  }

  async begin(session: Session, cadence: Cadence) {
    const setup = await this.onboarding.read(session);
    if (!setup.selectedNumber || !setup.voiceStatus) throw new ConflictException("Finish setup and choose a number first.");

    if (sandboxEnabled()) {
      await this.onboarding.withOwner(session, async (client) => {
        const result = await client.query(
          `UPDATE receptionist_setup SET
            checkout_cadence = COALESCE(checkout_cadence, $2),
            sandbox_completed_at = COALESCE(sandbox_completed_at, now()), updated_at = now()
           WHERE tenant_id = $1 AND selected_number = $3 AND voice_status IS NOT NULL`,
          [session.tenant_id, cadence, setup.selectedNumber],
        );
        if (!result.rowCount) throw new ConflictException("The number selection changed. Open checkout again.");
      });
      return { mode: "sandbox" as const };
    }

    const [stripe, config] = this.stripe();
    if (config.secretKey.startsWith("sk_live_") || config.secretKey.startsWith("rk_live_")) {
      if (!twilioConfig()?.origin || process.env.TWILIO_PROVISIONING_ENABLED !== "true") {
        throw new ServiceUnavailableException("Connect Twilio provisioning before accepting live subscriptions.");
      }
    }
    const attempt = await this.onboarding.withOwner(session, async (client) => {
      const { rows: [saved] } = await client.query<{ selected_number: string; voice_status: string }>(
        "SELECT selected_number, voice_status FROM receptionist_setup WHERE tenant_id = $1", [session.tenant_id],
      );
      if (saved?.selected_number !== setup.selectedNumber || !saved.voice_status) {
        throw new ConflictException("The number selection changed. Open checkout again.");
      }
      const { rows: [customer] } = await client.query<{ email: string }>("SELECT email FROM users WHERE id = $1", [session.user_id]);
      const { rows: [current] } = await client.query<ActivationRecord>(
        `INSERT INTO receptionist_activation (tenant_id, number, cadence) VALUES ($1, $2, $3)
         ON CONFLICT (tenant_id) DO UPDATE SET updated_at = now() RETURNING *`, [session.tenant_id, setup.selectedNumber, cadence],
      );
      return { ...current, email: customer.email };
    });
    if (attempt.state !== "checkout") return { mode: "pending" as const };
    if (attempt.cadence !== cadence) throw new ConflictException(`A ${attempt.cadence} checkout is already in progress.`);

    const metadata = { tenant: session.tenant_id, attempt: attempt.attempt_id };
    let checkout: Stripe.Checkout.Session;
    if (attempt.stripe_checkout_id) {
      checkout = await stripe.checkout.sessions.retrieve(attempt.stripe_checkout_id);
      if (checkout.status === "complete") {
        await this.recordCheckout(stripe, checkout);
        return { mode: "pending" as const };
      }
      if (checkout.status === "expired") {
        await this.onboarding.withOwner(session, async (client) => {
          await client.query(
            `UPDATE receptionist_activation SET stripe_checkout_id = NULL, attempt_id = gen_random_uuid(), updated_at = now()
             WHERE tenant_id = $1 AND attempt_id = $2 AND state = 'checkout' AND stripe_checkout_id = $3`,
            [session.tenant_id, attempt.attempt_id, checkout.id],
          );
        });
        throw new ConflictException("Checkout expired. Select Start again to open a new session.");
      }
    } else {
      checkout = await stripe.checkout.sessions.create({
        mode: "subscription", ui_mode: "embedded_page", customer_email: attempt.email,
        payment_method_collection: "always", client_reference_id: attempt.attempt_id,
        line_items: [{ price: config[cadence], quantity: 1 }],
        return_url: `${webOrigin()}/onboarding?checkout={CHECKOUT_SESSION_ID}`,
        metadata, subscription_data: {
          metadata, trial_period_days: 7, trial_settings: { end_behavior: { missing_payment_method: "cancel" } },
        },
      }, { idempotencyKey: `receptionist-checkout-${attempt.attempt_id}` });
      await this.onboarding.withOwner(session, async (client) => {
        await client.query(
          `UPDATE receptionist_activation SET stripe_checkout_id = $2, updated_at = now()
           WHERE tenant_id = $1 AND attempt_id = $3 AND (stripe_checkout_id IS NULL OR stripe_checkout_id = $2)`,
          [session.tenant_id, checkout.id, attempt.attempt_id],
        );
      });
    }
    if (!checkout.client_secret) throw new ServiceUnavailableException("Stripe checkout couldn’t be opened.");
    return { mode: "stripe" as const, secret: checkout.client_secret, publishableKey: config.publishableKey };
  }

  async status(session: Session, confirm: boolean): Promise<{
    number: string; cadence: Cadence; state: ActivationRecord["state"]; subscription: string;
  } | null> {
    const activation = await this.onboarding.withOwner(session, async (client) => {
      const { rows: [row] } = await client.query<ActivationRecord>(
        "SELECT * FROM receptionist_activation WHERE tenant_id = $1", [session.tenant_id],
      );
      return row;
    });
    if (confirm && activation?.stripe_checkout_id && activation.state !== "active" && activation.state !== "unavailable") {
      await this.onboarding.limit(session, "checkout-status", 20);
      const [stripe] = this.stripe();
      const checkout = await stripe.checkout.sessions.retrieve(activation.stripe_checkout_id);
      if (checkout.status === "complete") await this.recordCheckout(stripe, checkout);
      return this.status(session, false);
    }
    return activation ? {
      number: activation.number, cadence: activation.cadence, state: activation.state, subscription: activation.stripe_status,
    } : null;
  }

  async portal(session: Session) {
    const subscriptionId = await this.onboarding.withOwner(session, async (client) => {
      const { rows: [active] } = await client.query<{ stripe_subscription_id: string | null }>(
        "SELECT stripe_subscription_id FROM receptionist_activation WHERE tenant_id = $1", [session.tenant_id],
      );
      return active?.stripe_subscription_id;
    });
    if (!subscriptionId) throw new ConflictException("This workspace doesn’t have a Stripe subscription yet.");
    await this.onboarding.limit(session, "billing-portal", 12);
    const [stripe] = this.stripe();
    try {
      const subscription = await stripe.subscriptions.retrieve(subscriptionId);
      if (subscription.metadata.tenant !== session.tenant_id) throw new Error("Unexpected subscription owner.");
      const portal = await stripe.billingPortal.sessions.create({
        customer: typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id,
        return_url: `${webOrigin()}/onboarding`,
      });
      return { url: portal.url };
    } catch {
      throw new ServiceUnavailableException("Stripe billing settings couldn’t open.");
    }
  }

  async webhook(body: Buffer, signature: string | undefined) {
    const [stripe, config] = this.stripe();
    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(body, signature ?? "", config.webhookSecret);
    } catch {
      throw new BadRequestException("Invalid Stripe signature.");
    }
    if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
      await this.recordCheckout(stripe, event.data.object);
    } else if (event.type === "customer.subscription.updated" || event.type === "customer.subscription.deleted") {
      const subscription = await stripe.subscriptions.retrieve(event.data.object.id);
      await this.recordSubscription(subscription);
    }
    return { received: true };
  }

  private stripe() {
    const config = stripeConfig();
    if (!config) throw new ServiceUnavailableException("Live checkout requires a connected Stripe account and configured prices.");
    return [new Stripe(config.secretKey, { timeout: 7000, maxNetworkRetries: 1 }), config] as const;
  }

  private async recordCheckout(stripe: Stripe, checkout: Stripe.Checkout.Session) {
    if (checkout.mode !== "subscription" || checkout.status !== "complete" || !checkout.subscription
      || (checkout.payment_status !== "paid" && checkout.payment_status !== "no_payment_required")) return;
    const subscriptionId = typeof checkout.subscription === "string" ? checkout.subscription : checkout.subscription.id;
    const subscription = await stripe.subscriptions.retrieve(subscriptionId);
    if (checkout.metadata?.tenant !== subscription.metadata.tenant || checkout.metadata?.attempt !== subscription.metadata.attempt) return;
    await this.recordSubscription(subscription, checkout.id);
  }

  private async recordSubscription(subscription: Stripe.Subscription, checkoutId?: string) {
    const { tenant, attempt } = subscription.metadata;
    if (![tenant, attempt].every((value) => typeof value === "string" && /^[0-9a-f-]{36}$/i.test(value))) return;

    await this.database.transaction(async (client) => {
      await client.query("SELECT set_config('app.billing_tenant_id', $1, true)", [tenant]);
      const { rows: [row] } = await client.query<ActivationRecord>(
        "SELECT * FROM receptionist_activation WHERE tenant_id = $1 AND attempt_id = $2 FOR UPDATE", [tenant, attempt],
      );
      if (!row || (row.stripe_subscription_id && row.stripe_subscription_id !== subscription.id)
        || (checkoutId && row.stripe_checkout_id && row.stripe_checkout_id !== checkoutId)
        || (!checkoutId && row.stripe_subscription_id !== subscription.id)) return;
      await client.query(
        `UPDATE receptionist_activation SET stripe_checkout_id = COALESCE(stripe_checkout_id, $4),
         stripe_subscription_id = $2, stripe_status = $3, updated_at = now() WHERE tenant_id = $1`,
        [tenant, subscription.id, subscription.status, checkoutId ?? null],
      );
      if (!entitled(subscription.status) || row.state === "active" || row.state === "unavailable") return;
      await client.query("UPDATE receptionist_activation SET state = 'provisioning' WHERE tenant_id = $1", [tenant]);
      if (!subscription.livemode || (row.retry_at && row.retry_at.getTime() > Date.now())) return;

      try {
        const result = await rentNumber(row.number, row.attempt_id);
        await client.query(
          `UPDATE receptionist_activation SET state = $2, twilio_sid = $3, retry_at = NULL, updated_at = now() WHERE tenant_id = $1`,
          [tenant, result.state, result.state === "active" ? result.sid : null],
        );
      } catch {
        await client.query("UPDATE receptionist_activation SET retry_at = now() + interval '30 seconds' WHERE tenant_id = $1", [tenant]);
      }
    });
  }
}
