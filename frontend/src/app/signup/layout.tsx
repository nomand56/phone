import Link from "next/link";
import type { ReactNode } from "react";

export default function SignupLayout({ children }: { children: ReactNode }) {
  return (
    <main className="entry">
      <Link href="/" className="entry-brand">
        <span className="brand-mark" aria-hidden="true"><span /><span /><span /><span /></span>
        AI Receptionist
      </Link>
      <section className="entry-card">{children}</section>
    </main>
  );
}
