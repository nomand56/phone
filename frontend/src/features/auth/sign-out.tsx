"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function SignOut() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);

  async function signOut() {
    setPending(true);
    setError(false);
    try {
      const response = await fetch("/api/v1/auth/logout", { method: "POST" });
      if (!response.ok) throw new Error("Sign-out failed.");
      router.replace("/");
      router.refresh();
    } catch {
      setError(true);
      setPending(false);
    }
  }

  return (
    <div className="sign-out">
      {error && <p className="message error" role="alert">Couldn’t sign out. Try again.</p>}
      <button className="secondary" type="button" onClick={signOut} disabled={pending}>
        {pending ? "Signing out…" : "Sign out"}
      </button>
    </div>
  );
}
