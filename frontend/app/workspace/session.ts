import "server-only";
import { cookies } from "next/headers";

export interface Tenant {
  id: string;
  displayName: string;
  country: string;
  timeZone: string;
  status: string;
}

type WorkspaceResult = { tenant: Tenant; state: "ready" } | {
  tenant: null;
  state: "signed-out" | "forbidden" | "unavailable";
};

export async function readWorkspace(): Promise<WorkspaceResult> {
  const cookie = (await cookies()).get("phone_session");
  if (!cookie) return { tenant: null, state: "signed-out" };
  if (!/^[A-Za-z0-9_-]{43}$/.test(cookie.value)) return { tenant: null, state: "signed-out" };

  try {
    const response = await fetch(`${process.env.API_ORIGIN ?? "http://127.0.0.1:4000"}/v1/tenants/current`, {
      headers: { Cookie: `phone_session=${cookie.value}` },
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    if (response.status === 401) return { tenant: null, state: "signed-out" };
    if (response.status === 403) return { tenant: null, state: "forbidden" };
    if (!response.ok) return { tenant: null, state: "unavailable" };
    return { tenant: await response.json(), state: "ready" };
  } catch {
    return { tenant: null, state: "unavailable" };
  }
}
