"use client";

import { useState } from "react";
import { apiRequest } from "@/lib/api-request";
import { CheckoutStep } from "./checkout-step";
import { GoalsStep, Icon, SingleChoice } from "./journey-options";
import { NumberStep } from "./number-step";
import type { Capability, DiscoveryAnswer, Setup, VoiceChoice } from "./onboarding.types";
import { TrainingStage } from "./training-stage";
import { VoicePreview } from "./voice-preview";

const labels = ["Current calls", "Missed calls", "Agent tasks", "Training", "Voice", "Number", "Checkout"];

function resume(setup: Setup): number {
  if (setup.sandboxCompletedAt) return 6;
  if (!setup.discovery?.answer) return 0;
  if (!setup.discovery.missed) return 1;
  if (!setup.discovery.capabilities) return 2;
  if (!setup.profile || !setup.rules) return 3;
  if (!setup.voiceStatus) return 4;
  return setup.selectedNumber ? 6 : 5;
}

export function SetupWizard({ initialSetup }: { initialSetup: Setup }) {
  const [setup, setSetup] = useState(initialSetup);
  const [step, setStep] = useState(() => resume(initialSetup));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  function go(index: number) {
    setError("");
    setStep(index);
    window.scrollTo(0, 0);
  }

  async function save(path: string, body: object, next: number | ((result: Setup) => number)) {
    setError("");
    setBusy(true);
    try {
      const result = await apiRequest<Setup>(path, "PATCH", body);
      setSetup(result);
      go(typeof next === "function" ? next(result) : next);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Couldn’t save your progress.");
    } finally { setBusy(false); }
  }

  function discovery(field: "answer" | "missed" | "capabilities", value: DiscoveryAnswer | Capability[], next: number) {
    void save("onboarding/discovery", { field, value }, next);
  }

  function voice(voice: VoiceChoice, skipped: boolean) {
    void save("onboarding/voice", { voice, skipped }, (result) => result.selectedNumber ? 6 : 5);
  }

  return (
    <main className="journey">
      <div className="journey-container">
        <nav className="journey-progress" aria-label="Onboarding progress">
          <ol>
            {labels.map((label, index) => <li key={label} title={label} aria-current={index === step ? "step" : undefined}
              className={index < step || setup.sandboxCompletedAt ? "completed" : ""}><span>{label}</span></li>)}
          </ol>
          <div className="journey-back-row">
            {step > 0 && !setup.sandboxCompletedAt && (
              <button type="button" className="journey-back" disabled={busy} onClick={() => go(step - 1)}>
                <Icon name="arrow-left" />Back
              </button>
            )}
          </div>
        </nav>
        <section className={`journey-content journey-content-${step + 1}`} aria-label={labels[step]}>
          {step === 0 && <SingleChoice key="answer" field="answer" saved={setup.discovery?.answer} busy={busy}
            onChoice={(value) => discovery("answer", value, 1)} />}
          {step === 1 && <SingleChoice key="missed" field="missed" saved={setup.discovery?.missed} busy={busy}
            onChoice={(value) => discovery("missed", value, 2)} />}
          {step === 2 && <GoalsStep saved={setup.discovery?.capabilities} busy={busy}
            onChoice={(value) => discovery("capabilities", value, 3)} />}
          {step === 3 && <TrainingStage setup={setup} onTrained={(result) => { setSetup(result); go(4); }} />}
          {step === 4 && <VoicePreview setup={setup} busy={busy} onDone={voice} />}
          {step === 5 && <NumberStep key="number" saved={setup.selectedNumber}
            onSelect={(result) => { setSetup(result); go(6); }} />}
          {step === 6 && <CheckoutStep setup={setup} onComplete={setSetup} onBack={() => go(5)} />}
          {error && <p role="alert" className="journey-error">{error}</p>}
        </section>
      </div>
    </main>
  );
}
