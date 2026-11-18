import "server-only";
import { sessionRequest } from "@/features/auth/session-request";
import type { Tenant } from "./workspace.types";

type WorkspaceResult = { tenant: Tenant; state: "ready" } | {
  tenant: null;
  state: "signed-out" | "forbidden" | "unavailable";
};

export async function readWorkspace(): Promise<WorkspaceResult> {
  try {
    const response = await sessionRequest("tenants/current");
    if (!response || response.status === 401) return { tenant: null, state: "signed-out" };
    if (response.status === 403) return { tenant: null, state: "forbidden" };
    if (!response.ok) return { tenant: null, state: "unavailable" };
    return { tenant: await response.json(), state: "ready" };
  } catch {
    return { tenant: null, state: "unavailable" };
  }
}
