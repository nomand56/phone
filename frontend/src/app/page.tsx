import { redirect } from "next/navigation";
import { SignIn } from "@/features/auth/sign-in";
import { readWorkspace } from "@/features/workspace/workspace.server";

export default async function Home() {
  const { tenant } = await readWorkspace();
  if (tenant) redirect("/workspace");

  return (
    <main className="entry">
      <div className="entry-brand">
        <span className="brand-mark" aria-hidden="true"><span /><span /><span /><span /></span>
        <span>AI Receptionist</span>
      </div>
      <section className="entry-card" aria-labelledby="entry-title">
        <h1 id="entry-title">Sign in to your workspace</h1>
        <SignIn />
      </section>
    </main>
  );
}
