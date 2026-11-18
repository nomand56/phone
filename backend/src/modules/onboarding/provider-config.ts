import { webOrigin } from "../../config/env.js";

export function sandboxEnabled(): boolean {
  return process.env.ONBOARDING_SANDBOX === "true" && process.env.NODE_ENV !== "production"
    && ["localhost", "127.0.0.1", "[::1]"].includes(new URL(webOrigin()).hostname);
}

export function sandboxNumber(number: string): boolean {
  return /^\+1[2-9]\d{2}55501\d{2}$/.test(number);
}

export function twilioConfig() {
  const { TWILIO_ACCOUNT_SID: account, TWILIO_AUTH_TOKEN: token, TWILIO_PUBLIC_ORIGIN: raw } = process.env;
  if (!account || !token) return undefined;
  let origin: string | undefined;
  if (raw) {
    const url = new URL(raw);
    if (url.origin !== raw || url.protocol !== "https:") throw new Error("TWILIO_PUBLIC_ORIGIN must be an HTTPS origin.");
    origin = url.origin;
  }
  return { account, token, origin };
}

export function stripeConfig() {
  const {
    STRIPE_SECRET_KEY: secretKey, STRIPE_PUBLISHABLE_KEY: publishableKey,
    STRIPE_WEBHOOK_SECRET: webhookSecret, STRIPE_MONTHLY_PRICE_ID: monthly, STRIPE_YEARLY_PRICE_ID: yearly,
  } = process.env;
  return secretKey && publishableKey && webhookSecret && monthly && yearly
    ? { secretKey, publishableKey, webhookSecret, monthly, yearly } : undefined;
}
