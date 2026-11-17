export function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

export function webOrigin(): string {
  const url = new URL(requiredEnv("WEB_ORIGIN"));
  if (url.origin !== process.env.WEB_ORIGIN || !["http:", "https:"].includes(url.protocol)) {
    throw new Error("WEB_ORIGIN must be an HTTP(S) origin without a path or trailing slash.");
  }
  if (process.env.NODE_ENV === "production" && url.protocol !== "https:") {
    throw new Error("WEB_ORIGIN must use HTTPS in production.");
  }
  return url.origin;
}
