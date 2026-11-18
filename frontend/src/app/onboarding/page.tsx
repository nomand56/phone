import "lucide-static/font/lucide.css";
import "./journey.css";
import Link from "next/link";
import { redirect } from "next/navigation";
import { sessionRequest } from "@/features/auth/session-request";
import type { Setup } from "@/features/onboarding/onboarding.types";
import { SetupWizard } from "@/features/onboarding/setup-wizard";

export default async function OnboardingPage() {
  const response = await sessionRequest("onboarding").catch(() => null);
  if (response === undefined || response?.status === 401) redirect("/");
  const setup: Setup | null = response?.ok ? await response.json() : null;
  if (setup) return <SetupWizard initialSetup={setup} />;

  return (
    <main className="workspace">
      <section className="settings">
        <h1>Setup unavailable</h1>
        <p>{response?.status === 403 ? "Only the business owner can manage receptionist setup."
          : "The setup couldn’t be loaded. Refresh the page to try again."}</p>
        <Link href="/workspace">Return to workspace</Link>
      </section>
    </main>
  );
}
