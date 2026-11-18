"use client";

import Link from "next/link";
import { type FormEvent, useState } from "react";
import { apiRequest } from "@/lib/api-request";

export function SignupForm() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState<{ localVerificationUrl?: string }>();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setPending(true);
    try {
      setSent(await apiRequest("auth/signup", "POST", { email }));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Couldn’t start signup.");
    } finally {
      setPending(false);
    }
  }

  if (sent) {
    return (
      <div className="form">
        <h1>Verify your email</h1>
        <p>{sent.localVerificationUrl
          ? <>Use the local verification link to continue as <strong>{email}</strong>.</>
          : <>If the address can be used, a verification link will arrive at <strong>{email}</strong>.</>}</p>
        {sent.localVerificationUrl && (
          <a className="primary action-link" href={sent.localVerificationUrl}>Open local verification link</a>
        )}
        <button type="button" className="secondary" onClick={() => setSent(undefined)}>Use another email or resend</button>
      </div>
    );
  }

  return (
    <>
      <h1>Create your account</h1>
      <form className="form" onSubmit={submit}>
        <label>
          Work email
          <input type="email" autoComplete="email" required maxLength={254} value={email}
            onChange={(event) => setEmail(event.target.value)} />
        </label>
        {error && <p className="message error" role="alert">{error}</p>}
        <button className="primary" type="submit" disabled={pending}>{pending ? "Sending…" : "Continue with email"}</button>
      </form>
      <p className="entry-footer">Already have an account? <Link href="/">Sign in</Link></p>
    </>
  );
}
