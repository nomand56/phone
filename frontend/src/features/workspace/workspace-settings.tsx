"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import type { Tenant } from "./workspace.types";

const commonZones = [
  "America/Vancouver", "America/Edmonton", "America/Regina", "America/Winnipeg",
  "America/Toronto", "America/Halifax", "America/St_Johns",
];

export function WorkspaceSettings({ tenant }: { tenant: Tenant }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<{ error: boolean; text: string }>();
  const disabled = pending || tenant.status === "suspended";
  const country = new Intl.DisplayNames(["en-CA"], { type: "region" }).of(tenant.country);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    setFeedback(undefined);
    try {
      const response = await fetch("/api/v1/tenants/current", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName: form.get("displayName"), timeZone: form.get("timeZone") }),
      });
      if (response.status === 401) {
        router.replace("/");
        router.refresh();
        return;
      }
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        const text = typeof body.message === "string" && [400, 403].includes(response.status)
          ? body.message : "The profile couldn’t be saved. Try again.";
        setFeedback({ error: true, text });
        return;
      }
      setFeedback({ error: false, text: "Business profile saved." });
      router.refresh();
    } catch {
      setFeedback({ error: true, text: "The profile couldn’t be saved. Try again." });
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="form" onSubmit={save}>
      <label>
        Business name
        <input name="displayName" defaultValue={tenant.displayName} disabled={disabled} maxLength={120} required />
      </label>
      <div className="form-row">
        <label>
          Time zone
          <input name="timeZone" list="time-zones" defaultValue={tenant.timeZone} disabled={disabled} maxLength={80} required />
          <datalist id="time-zones">
            {commonZones.map((zone) => <option key={zone} value={zone} />)}
          </datalist>
        </label>
        <label>
          Country
          <input value={country ?? tenant.country} readOnly />
        </label>
      </div>
      <div className="form-footer">
        <button className="primary" type="submit" disabled={disabled}>{pending ? "Saving…" : "Save changes"}</button>
        {feedback && <p className={feedback.error ? "message error" : "message"}
          role={feedback.error ? "alert" : "status"}>{feedback.text}</p>}
      </div>
    </form>
  );
}
