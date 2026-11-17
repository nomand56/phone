export const SESSION_COOKIE = "phone_session";
export const SESSION_TTL_SECONDS = 8 * 60 * 60;

export interface Session {
  user_id: string;
  tenant_id: string;
}

export function readSessionToken(cookieHeader: string | undefined): string | undefined {
  const prefix = `${SESSION_COOKIE}=`;
  const cookies = cookieHeader?.split(";").map((part) => part.trim()) ?? [];
  const matches = cookies.filter((cookie) => cookie.startsWith(prefix));
  const candidate = matches.length === 1 ? matches[0].slice(prefix.length) : "";
  return /^[A-Za-z0-9_-]{43}$/.test(candidate) ? candidate : undefined;
}
