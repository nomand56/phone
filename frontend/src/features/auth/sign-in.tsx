"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";

export function SignIn() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    setError("");
    try {
      const response = await fetch("/api/v1/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: form.get("email"), password: form.get("password") }),
      });
      if (response.ok) {
        router.replace("/workspace");
        router.refresh();
        return;
      }

      const message = {
        400: "Enter a valid email and password.",
        401: "Check your email and password and try again.",
        429: "Too many sign-in attempts. Try again later.",
      }[response.status as 400 | 401 | 429];
      setError(message ?? "Sign-in is temporarily unavailable. Try again shortly.");
    } catch {
      setError("Sign-in is temporarily unavailable. Try again shortly.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="form" onSubmit={submit}>
      <label>
        Email
        <input type="email" name="email" autoComplete="username" maxLength={254} required />
      </label>
      <label>
        Password
        <input type="password" name="password" autoComplete="current-password" maxLength={1024} required />
      </label>
      {error && <p className="message error" role="alert">{error}</p>}
      <button className="primary" type="submit" disabled={pending}>{pending ? "Signing in…" : "Sign in"}</button>
    </form>
  );
}
