"use client";

import { type FormEvent, useState } from "react";
import type { Capability, DiscoveryAnswer } from "./onboarding.types";

const answerOptions = [
  ["myself", "I answer them myself", "user"],
  ["team", "Someone on my team", "users"],
  ["service", "An answering service", "headset"],
  ["ai", "Another AI receptionist", "sparkles"],
];

const missedOptions = [
  ["voicemail", "They go to voicemail", "voicemail"],
  ["service", "An answering service", "headset"],
  ["ai", "Another AI receptionist", "sparkles"],
];

export const tasks = [
  { id: "messages", title: "Take messages", description: "Who called and why, saved for your team", icon: "message-square" },
  { id: "leads", title: "Capture & qualify leads", description: "Ask your intake questions on calls", icon: "clipboard-list" },
  { id: "routing", title: "Transfer & route calls", description: "Send callers to the right person or team", icon: "corner-up-right" },
  { id: "questions", title: "Answer caller questions", description: "Based on your business, website & FAQs", icon: "circle-help" },
  { id: "appointments", title: "Book appointments", description: "Google Calendar, Outlook, and more", icon: "calendar" },
  { id: "crm", title: "Send calls to your CRM", description: "HubSpot, Clio, Zapier, and more", icon: "database" },
] satisfies { id: Capability; title: string; description: string; icon: string }[];

export function Icon({ name }: { name: string }) {
  return <i className={`icon-${name} journey-icon`} aria-hidden="true" />;
}

export function SingleChoice({ field, saved, busy, onChoice }: {
  field: "answer" | "missed";
  saved?: DiscoveryAnswer;
  busy: boolean;
  onChoice: (choice: DiscoveryAnswer) => void;
}) {
  const [other, setOther] = useState(saved?.kind === "other");
  const [detail, setDetail] = useState(saved?.detail ?? "");
  function saveOther(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (detail.trim()) onChoice({ kind: "other", detail });
  }

  return (
    <>
      <h1>{field === "answer" ? "Who answers your calls today?" : "When nobody can pick up?"}</h1>
      <div className="journey-choice-list">
        {(field === "answer" ? answerOptions : missedOptions).map(([value, name, icon]) => (
          <button type="button" key={value} className="journey-choice" disabled={busy}
            aria-pressed={saved?.kind === value} onClick={() => onChoice({ kind: value })}>
            <Icon name={icon} />{name}
          </button>
        ))}
      </div>
      {other ? (
        <form className="journey-form journey-other" onSubmit={saveOther}>
          <label><span className="journey-label">Tell us what happens</span>
            <input value={detail} onChange={(event) => setDetail(event.target.value)} required maxLength={200} />
          </label>
          <button className="journey-primary" type="submit" disabled={busy || !detail.trim()}>Continue <Icon name="arrow-right" /></button>
        </form>
      ) : <button type="button" className="journey-text" onClick={() => setOther(true)} disabled={busy}>Something else? Tell us</button>}
    </>
  );
}

export function GoalsStep({ saved, busy, onChoice }: {
  saved?: Capability[];
  busy: boolean;
  onChoice: (selected: Capability[]) => void;
}) {
  const [selected, setSelected] = useState<Capability[]>(saved ?? []);
  return (
    <>
      <h1>What should your agent handle?</h1>
      <p className="journey-subtitle">Pick all that apply. You can change this later.</p>
      <div className="journey-task-grid">
        {tasks.map(({ id, title, description, icon }) => {
          const picked = selected.includes(id);
          return <button type="button" className="journey-choice journey-task" key={id} aria-pressed={picked}
            disabled={busy} onClick={() => setSelected(picked ? selected.filter((value) => value !== id) : [...selected, id])}>
            <Icon name={icon} />
            <span><strong>{title}</strong><small>{description}</small></span>
          </button>;
        })}
      </div>
      <button type="button" className="journey-text" onClick={() => onChoice([])} disabled={busy}>I’m just exploring</button>
      <button type="button" className="journey-primary journey-continue" disabled={busy || !selected.length} onClick={() => onChoice(selected)}>
        {busy ? "Saving…" : "Continue"}
      </button>
    </>
  );
}
