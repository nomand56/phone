"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { apiRequest } from "@/lib/api-request";
import { Icon } from "./journey-options";
import { formatNumber } from "./number-step";
import type { Activation, Cadence, Setup } from "./onboarding.types";

interface Plan { cadence: Cadence; amount: number; currency: string }
interface Tariffs { sandbox: boolean; plans: Plan[] }
type Checkout = { mode: "sandbox" | "pending" } | { mode: "stripe"; secret: string; publishableKey: string };

function money(amount: number, currency: string) {
  return new Intl.NumberFormat("en-CA", {
    style: "currency", currency: currency.toUpperCase(), minimumFractionDigits: amount % 100 === 0 ? 0 : 2,
  }).format(amount / 100);
}

export function CheckoutStep({ setup, onComplete, onBack }: {
  setup: Setup;
  onComplete: (next: Setup) => void;
  onBack: () => void;
}) {
  const [tariffs, setTariffs] = useState<Tariffs>();
  const [cadence, setCadence] = useState<Cadence>(setup.cadence ?? "monthly");
  const [activation, setActivation] = useState<Activation | null>(null);
  const [embedded, setEmbedded] = useState<{ secret: string; publishableKey: string }>();
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const mount = useRef<HTMLDivElement>(null);

  const confirm = useCallback(async () => {
    try {
      const result = await apiRequest<{ activation: Activation | null }>("onboarding/activation/confirm", "POST", {});
      setActivation(result.activation);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Activation status is unavailable.");
    }
  }, []);

  useEffect(() => {
    if (setup.sandboxCompletedAt) { setBusy(false); return; }
    let active = true;
    void Promise.all([apiRequest<Tariffs>("onboarding/plans"), apiRequest<{ activation: Activation | null }>("onboarding/activation")])
      .then(([prices, { activation: status }]) => {
        if (!active) return;
        setTariffs(prices);
        setActivation(status);
        if (status) setCadence(status.cadence);
        if (new URLSearchParams(window.location.search).has("checkout")) void confirm();
      })
      .catch((failure) => { if (active) setError(failure.message); })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [setup.sandboxCompletedAt, confirm]);

  useEffect(() => {
    if (!embedded || !mount.current) return;
    let destroyed = false;
    let checkout: { destroy: () => void } | undefined;
    const container = mount.current;
    void import("@stripe/stripe-js").then(({ loadStripe }) => loadStripe(embedded.publishableKey)).then(async (stripe) => {
      if (!stripe || destroyed) return;
      const form = await stripe.createEmbeddedCheckoutPage({
        clientSecret: embedded.secret,
        onComplete: () => { setEmbedded(undefined); void confirm(); },
      });
      if (destroyed) { form.destroy(); return; }
      checkout = form;
      form.mount(container);
    }).catch(() => { if (!destroyed) { setEmbedded(undefined); setError("The secure payment form couldn’t be loaded."); } });
    return () => { destroyed = true; checkout?.destroy(); };
  }, [embedded, confirm]);

  async function begin() {
    setBusy(true);
    setError("");
    try {
      const result = await apiRequest<Checkout>("onboarding/checkout", "POST", { cadence });
      if (result.mode === "sandbox") onComplete(await apiRequest<Setup>("onboarding"));
      else if (result.mode === "stripe") setEmbedded(result);
      else await confirm();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Couldn’t start checkout.");
    } finally { setBusy(false); }
  }

  async function manageBilling() {
    setBusy(true);
    setError("");
    try {
      const { url } = await apiRequest<{ url: string }>("onboarding/billing-portal", "POST", {});
      window.location.assign(url);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Billing settings couldn’t open.");
      setBusy(false);
    }
  }

  const number = setup.selectedNumber ? formatNumber(setup.selectedNumber) : "";
  const plan = tariffs?.plans.find((item) => item.cadence === cadence);
  const monthly = tariffs?.plans.find((item) => item.cadence === "monthly");
  const yearly = tariffs?.plans.find((item) => item.cadence === "yearly");
  const saving = monthly && yearly && monthly.currency === yearly.currency
    ? Math.max(0, Math.round(100 * (1 - yearly.amount / (monthly.amount * 12)))) : 0;
  const subscriptionEligible = activation && ["active", "trialing"].includes(activation.subscription);
  const finished = Boolean(setup.sandboxCompletedAt) || (activation?.state === "active" && subscriptionEligible);
  const trained = [setup.training?.domain, number].filter(Boolean).join(" · ");

  return (
    <div className="journey-checkout">
      <h1>{setup.name}’s receptionist is ready</h1>
      {trained && <p className="journey-subtitle">{setup.training?.domain ? "Trained on " : ""}{trained}</p>}
      <section className="journey-checkout-card">
        <ul className="journey-checklist">
          <li><Icon name="check" />Answers incoming calls on an active number</li>
          <li><Icon name="check" />Answers questions using your business information</li>
          <li><Icon name="check" />Collects callback messages for your team</li>
          <li><Icon name="check" />Lets you test your agent before going live</li>
        </ul>
        <div className="journey-payment">
          {finished ? (
            <>
              <h2>{setup.sandboxCompletedAt ? "Sandbox trial started" : "Your number is active"}</h2>
              <p className="journey-muted">{setup.sandboxCompletedAt
                ? "Your setup was saved locally. This test number cannot receive calls."
                : "Call your new number directly to verify the greeting. Then you can forward your existing line through your carrier."}</p>
              <Link className="journey-primary" href="/workspace">Open workspace</Link>
              {!setup.sandboxCompletedAt && <button type="button" className="journey-secondary" disabled={busy}
                onClick={() => void manageBilling()}>Manage billing</button>}
            </>
          ) : activation && activation.state !== "checkout" && !subscriptionEligible ? (
            <>
              <h2>Subscription needs attention</h2>
              <p className="journey-muted">This number is paused until the subscription is active.</p>
              <button type="button" className="journey-secondary" disabled={busy}
                onClick={() => void manageBilling()}>Manage billing</button>
            </>
          ) : activation?.state === "unavailable" ? (
            <>
              <h2>Choose another number</h2>
              <p className="journey-muted">This number became unavailable. Your existing subscription can use a replacement.</p>
              <button type="button" className="journey-primary" onClick={onBack}>Choose a number</button>
            </>
          ) : activation?.state === "provisioning" ? (
            <>
              <h2>Activation pending</h2>
              <p className="journey-muted">Stripe confirmed your subscription. Number activation is tracked here.</p>
              <button type="button" className="journey-secondary" onClick={() => void confirm()}>Refresh status</button>
              <button type="button" className="journey-secondary" disabled={busy}
                onClick={() => void manageBilling()}>Manage billing</button>
            </>
          ) : embedded ? <div className="journey-stripe" ref={mount} /> : (
            <>
              <fieldset className="journey-segment journey-cadence">
                <legend className="journey-visually-hidden">Billing frequency</legend>
                <button type="button" aria-pressed={cadence === "monthly"} disabled={busy || Boolean(activation)}
                  onClick={() => setCadence("monthly")}>Monthly</button>
                <button type="button" aria-pressed={cadence === "yearly"} disabled={busy || Boolean(activation)}
                  onClick={() => setCadence("yearly")}>Yearly{saving ? <span>Save {saving}%</span> : null}</button>
              </fieldset>
              <div className="journey-payment-method"><Icon name="credit-card" />
                {tariffs?.sandbox ? "Sandbox checkout · No card needed" : "Secure payment form provided by Stripe"}</div>
              {plan && <div className="journey-price">
                <span><strong>Receptionist Pro</strong><small>7-day trial, then {money(plan.amount, plan.currency)}/{cadence === "monthly" ? "month" : "year"}</small></span>
                <strong>{money(0, plan.currency)} today</strong>
              </div>}
              <button type="button" className="journey-primary" disabled={busy || !plan} onClick={() => void begin()}>
                {busy ? "Loading…" : tariffs?.sandbox ? "Start sandbox trial" : "Start my free trial"}
              </button>
              <div className="journey-security"><Icon name={tariffs?.sandbox ? "flask-conical" : "lock"} />
                {tariffs?.sandbox ? "Local test only. No payment or number purchase." : "Payment details are handled securely by Stripe."}</div>
            </>
          )}
          {error && <p className="journey-error" role="alert">{error}</p>}
        </div>
      </section>
    </div>
  );
}
