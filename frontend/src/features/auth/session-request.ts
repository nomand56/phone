import "server-only";
import { cookies } from "next/headers";

export async function sessionRequest(path: string): Promise<Response | undefined> {
  const cookie = (await cookies()).get("phone_session");
  if (!cookie || !/^[A-Za-z0-9_-]{43}$/.test(cookie.value)) return undefined;
  return fetch(`${process.env.API_ORIGIN ?? "http://127.0.0.1:4000"}/v1/${path}`, {
    headers: { Cookie: `phone_session=${cookie.value}` },
    cache: "no-store",
    signal: AbortSignal.timeout(5000),
  });
}
