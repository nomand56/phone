"use client";

import { type FormEvent, useEffect, useRef, useState } from "react";
import { apiRequest } from "@/lib/api-request";
import { Icon } from "./journey-options";
import type { Setup, TrainingProgress } from "./onboarding.types";

export function AgentOrb({ rings = false }: { rings?: boolean }) {
  return <div className={`agent-orb-wrap${rings ? " with-rings" : ""}`} aria-hidden="true"><div className="agent-orb" /></div>;
}

export function TrainingStage({ setup, onTrained }: { setup: Setup; onTrained: (next: Setup) => void }) {
  const [manual, setManual] = useState(Boolean(setup.profile && !setup.profile.website));
  const [website, setWebsite] = useState(setup.profile?.website ?? "");
  const [name, setName] = useState(setup.profile?.name ?? (setup.name !== "New business" ? setup.name : ""));
  const [description, setDescription] = useState(setup.profile?.knowledge ?? "");
  const [progress, setProgress] = useState<TrainingProgress>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | undefined>(undefined);
  useEffect(() => () => abortRef.current?.abort(), []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (manual) {
        setProgress({ stage: "preparing" });
        const next = await apiRequest<Setup>("onboarding/train/manual", "POST", { name, knowledge: description, website: "" });
        onTrained(next);
        return;
      }
      const abort = new AbortController();
      abortRef.current = abort;
      setProgress({ stage: "reading" });
      const response = await fetch("/api/v1/onboarding/train/website", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ website }),
        signal: abort.signal,
      });
      if (!response.ok || !response.body) throw new Error("Website training couldn’t start. Try again or enter your business information.");
      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = "";
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          buffer += chunk.value;
          let boundary = buffer.indexOf("\n");
          while (boundary >= 0) {
            const update: TrainingProgress | { stage: "complete"; setup: Setup } | { stage: "error"; message: string } =
              JSON.parse(buffer.slice(0, boundary));
            buffer = buffer.slice(boundary + 1);
            if (update.stage === "complete") { onTrained(update.setup); return; }
            if (update.stage === "error") throw new Error(update.message);
            setProgress(update);
            boundary = buffer.indexOf("\n");
          }
        }
      } finally {
        reader.releaseLock();
      }
      throw new Error("Training ended before your agent was ready. Try again.");
    } catch (failure) {
      if (!(failure instanceof DOMException && failure.name === "AbortError")) {
        setError(failure instanceof Error ? failure.message : "Couldn’t prepare your agent.");
      }
    } finally {
      setBusy(false);
    }
  }

  if (progress && !error) return <TrainingProgressView progress={progress} />;

  return (
    <>
      <AgentOrb />
      <h1 className="journey-display">{manual ? "Tell us about your business" : "Let’s train your agent"}</h1>
      <p className="journey-subtitle">{manual ? "We’ll use this to train your receptionist." : "Paste your website and we’ll do the rest."}</p>
      <form className="journey-form journey-training-form" onSubmit={submit}>
        {manual ? (
          <>
            <label><span className="journey-label">Business name</span>
              <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Your business" maxLength={120} required />
            </label>
            <label><span className="journey-label">What does your business do?</span>
              <textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={4}
                placeholder="Describe your services, hours, and what callers usually ask." maxLength={4000} required />
            </label>
          </>
        ) : (
          <input aria-label="Business website" inputMode="url" autoComplete="url" value={website}
            onChange={(event) => setWebsite(event.target.value)} placeholder="yourwebsite.com" maxLength={320} required />
        )}
        {error && <p className="journey-error" role="alert">{error}</p>}
        <button type="submit" className="journey-primary" disabled={busy || (manual ? !name.trim() || !description.trim() : !website.trim())}>
          Continue <Icon name="arrow-right" />
        </button>
      </form>
      <button type="button" className="journey-text" onClick={() => { setManual(!manual); setError(""); setProgress(undefined); }} disabled={busy}>
        {manual ? "I have a website" : "I don’t have a website"}
      </button>
    </>
  );
}

function TrainingProgressView({ progress }: { progress: TrainingProgress }) {
  const stages = ["reading", "finding", "extracting", "preparing"];
  const labels = ["Reading your website", "Finding pages", "Extracting business info", "Preparing your agent"];
  const current = stages.indexOf(progress.stage);
  const cards = [["message-square", "Questions it asks callers"], ["house", "Business Info"], ["briefcase", "Services"],
    ["notebook", "Knowledge Base"], ["circle-help", "FAQs"], ["clock", "Hours"]];
  return (
    <div className="journey-training">
      <h1>Training your agent</h1>
      <section className="journey-training-status" aria-live="polite">
        <strong><span className="journey-live-dot" /> {current === 3 ? "Preparing…" : "Researching…"}</strong>
        <ol>
          {labels.map((label, index) => (
            <li key={label} className={index === current ? "running" : index < current ? "finished" : ""}>
              <span className="journey-stage-icon">{index < current ? <Icon name="check" /> : <span />}</span>{label}
              {index === 0 && current > 0 && <small>Connected</small>}
              {index === 1 && progress.pages && <small>{progress.pages.length} pages</small>}
              {index === 2 && progress.current && <small>{progress.current}</small>}
            </li>
          ))}
        </ol>
        {progress.pages?.length ? <div className="journey-read-pages">
          <p>Pages found on {progress.domain}</p>
          {progress.pages.map((page) => <span key={page}>{page}</span>)}
        </div> : null}
      </section>
      <div className="journey-training-grid" aria-hidden="true">
        {cards.map(([icon, title]) => <div className="journey-training-card" key={title}>
          <span><Icon name={icon} /> {title}</span><i /><i /><i />
        </div>)}
      </div>
    </div>
  );
}
