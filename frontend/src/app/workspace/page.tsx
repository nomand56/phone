import Link from "next/link";
import { redirect } from "next/navigation";
import { SignOut } from "@/features/auth/sign-out";
import { WorkspaceSettings } from "@/features/workspace/workspace-settings";
import { readWorkspace } from "@/features/workspace/workspace.server";

export default async function WorkspacePage() {
  const { tenant, state } = await readWorkspace();
  if (state === "signed-out") redirect("/");

  return (
    <>
      <header className="workspace-header">
        <div className="workspace-header-inner">
          <div className="brand">
            <span className="brand-mark" aria-hidden="true"><span /><span /><span /><span /></span>
            <span>AI Receptionist</span>
          </div>
          <SignOut />
        </div>
      </header>
      <main className="workspace">
        {tenant ? (
          <>
            <div className="workspace-title">
              <h1>{tenant.displayName}</h1>
              <span className="status">{tenant.status.replaceAll("_", " ")}</span>
            </div>
            <div className="workspace-actions">
              <Link className="primary action-link" href="/onboarding">Receptionist setup</Link>
              <Link className="secondary action-link" href="/workspace/messages">Caller messages</Link>
            </div>
            <section className="settings" aria-labelledby="settings-title">
              <h2 id="settings-title">Business profile</h2>
              <WorkspaceSettings tenant={tenant} />
            </section>
          </>
        ) : (
          <section className="settings" aria-labelledby="workspace-error">
            <h1 id="workspace-error">Workspace unavailable</h1>
            <p>{state === "forbidden" ? "Your account no longer has access to this workspace."
              : "The workspace couldn’t be loaded. Refresh the page to try again."}</p>
          </section>
        )}
      </main>
    </>
  );
}
