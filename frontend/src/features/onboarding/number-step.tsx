"use client";

import { type FormEvent, useCallback, useEffect, useState } from "react";
import { apiRequest } from "@/lib/api-request";
import { Icon } from "./journey-options";
import type { Setup } from "./onboarding.types";

interface Candidate { number: string; label: string; location: string }
interface Inventory { sandbox: boolean; options: Candidate[] }

export function formatNumber(number: string) {
  return number.replace(/^\+1(\d{3})(\d{3})(\d{4})$/, "($1) $2-$3");
}

export function NumberStep({ saved, onSelect }: { saved: string | null; onSelect: (next: Setup) => void }) {
  const [tab, setTab] = useState<"suggested" | "search">("suggested");
  const [area, setArea] = useState("");
  const [inventory, setInventory] = useState<Inventory>();
  const [selected, setSelected] = useState<string | null>(saved);
  const [busy, setBusy] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const show = useCallback((result: Inventory) => {
    setInventory(result);
    setSelected((value) => result.options.some(({ number }) => number === value) ? value : result.options[0]?.number ?? null);
  }, []);

  useEffect(() => {
    let mounted = true;
    void apiRequest<Inventory>("onboarding/numbers")
      .then((result) => { if (mounted) show(result); })
      .catch((failure) => { if (mounted) setError(failure.message); })
      .finally(() => { if (mounted) setBusy(false); });
    return () => { mounted = false; };
  }, [show]);

  async function load(code: string) {
    setBusy(true);
    setError("");
    try {
      show(await apiRequest<Inventory>(`onboarding/numbers?areaCode=${encodeURIComponent(code)}`));
    } catch (failure) {
      setInventory(undefined);
      setSelected(null);
      setError(failure instanceof Error ? failure.message : "Unavailable numbers.");
    } finally { setBusy(false); }
  }

  async function next() {
    if (!selected) return;
    setError("");
    setSaving(true);
    try { onSelect(await apiRequest<Setup>("onboarding/number", "PATCH", { number: selected })); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "Couldn’t save this number."); }
    finally { setSaving(false); }
  }

  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void load(area);
  }

  const choice = inventory?.options.find(({ number }) => number === selected);

  return (
    <div className="journey-number">
      <h1>Choose a number for your agent</h1>
      <p className="journey-subtitle">Forward your calls to it, or give it out directly.</p>
      <fieldset className="journey-segment">
        <legend className="journey-visually-hidden">Find a number</legend>
        <button type="button" aria-pressed={tab === "suggested"} disabled={busy || saving}
          onClick={() => { setTab("suggested"); void load(""); }}>Suggested</button>
        <button type="button" aria-pressed={tab === "search"} disabled={busy || saving}
          onClick={() => { setTab("search"); setError(""); }}>Search</button>
      </fieldset>
      {tab === "search" && (
        <form className="journey-question" onSubmit={search}>
          <input aria-label="Canadian area code" inputMode="numeric" pattern="[2-9][0-9]{2}" maxLength={3}
            placeholder="Area code" value={area} required onChange={(event) => setArea(event.target.value.replace(/\D/g, ""))} />
          <button type="submit" className="journey-secondary" disabled={busy || area.length !== 3}>Search</button>
        </form>
      )}
      {busy && <p className="journey-muted" role="status">Looking for available numbers…</p>}
      {!busy && choice && tab === "suggested" && (
        <div className="journey-suggestion">
          <span>Suggested for you{inventory?.sandbox ? " · Test number" : ""}</span>
          <strong>{formatNumber(choice.number)}</strong>
        </div>
      )}
      {!busy && tab === "search" && inventory?.options.length ? (
        <div className="journey-choice-list compact">
          {inventory.options.map((option) => (
            <button type="button" key={option.number} className="journey-choice" disabled={saving}
              aria-pressed={option.number === selected} onClick={() => setSelected(option.number)}>
              <Icon name="phone" />
              <span>{formatNumber(option.number)}<small>{option.location}{inventory.sandbox ? " · Test" : ""}</small></span>
            </button>
          ))}
        </div>
      ) : null}
      {!busy && inventory && !inventory.options.length && <p className="journey-muted">No available numbers were found. Try another area code.</p>}
      {error && <p role="alert" className="journey-error">{error}</p>}
      <button type="button" className="journey-primary" disabled={!choice || busy || saving} onClick={() => void next()}>
        {saving ? "Saving…" : "Continue with this number"}
      </button>
      <p className="journey-footnote">
        {inventory?.sandbox ? "Test numbers are for this local walkthrough."
          : "Availability is confirmed when your number is activated."}
      </p>
    </div>
  );
}
