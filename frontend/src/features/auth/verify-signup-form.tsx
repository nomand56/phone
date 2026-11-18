"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useState } from "react";
import { apiRequest } from "@/lib/api-request";

export function VerifySignupForm() {
  const router = useRouter();
  const [token, setToken] = useState<string>();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  useEffect(() => {
    setToken(new URLSearchParams(window.location.hash.slice(1)).get("token") ?? "");
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setError("");
    setPending(true);
    try {
      await apiRequest("auth/signup/verify", "POST", { token, password: form.get("password") });
      router.replace("/onboarding");
      router.refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Couldn’t verify your email.");
      setPending(false);
    }
  }

  return (
    <>
      <h1>Finish creating your account</h1>
      {token === "" ? (
        <p>Open the link from your verification email or <Link href="/signup">request a new link</Link>.</p>
      ) : (
        <form className="form" onSubmit={submit}>
          <label>
            Create password
            <input type="password" name="password" autoComplete="new-password" minLength={14} maxLength={256}
              aria-describedby="password-help" required />
          </label>
          <p className="field-help" id="password-help">Use at least 14 characters.</p>
          {error && <p className="message error" role="alert">{error}</p>}
          <button className="primary" type="submit" disabled={!token || pending}>
            {pending ? "Creating account…" : "Create account"}
          </button>
        </form>
      )}
    </>
  );
}
