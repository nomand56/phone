"use client";

import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { apiRequest } from "@/lib/api-request";
import { Icon } from "./journey-options";
import type { Setup, VoiceChoice } from "./onboarding.types";
import { AgentOrb } from "./training-stage";

const voices = [
  { id: "juniper", label: "Juniper", language: "en", pitch: 1.1, index: 0 },
  { id: "jessica", label: "Jessica", language: "en", pitch: 1.2, index: 1 },
  { id: "eric", label: "Eric", language: "en", pitch: .82, index: 2 },
  { id: "enrique", label: "Enrique", language: "es", pitch: .97, index: 0 },
] as const;

interface Recognition {
  lang: string;
  start(): void;
  abort(): void;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
}
type MicrophoneWindow = Window & {
  SpeechRecognition?: new () => Recognition;
  webkitSpeechRecognition?: new () => Recognition;
};

export function VoicePreview({ setup, busy, onDone }: {
  setup: Setup;
  busy: boolean;
  onDone: (voice: VoiceChoice, skipped: boolean) => void;
}) {
  const [voice, setVoice] = useState<VoiceChoice>(setup.voiceChoice ?? "juniper");
  const [mode, setMode] = useState<"idle" | "connecting" | "browser" | "realtime">("idle");
  const [listening, setListening] = useState(false);
  const [tested, setTested] = useState(setup.voiceStatus === "tested");
  const [error, setError] = useState("");
  const [question, setQuestion] = useState("");
  const [turn, setTurn] = useState<{ question: string; reply: string }>();
  const [sending, setSending] = useState(false);
  const rtc = useRef<{ peer: RTCPeerConnection; tracks: MediaStreamTrack[]; audio: HTMLAudioElement; timer?: number } | undefined>(undefined);
  const recognition = useRef<Recognition | undefined>(undefined);
  const active = useRef(true);

  const cleanupPreview = useCallback(() => {
    const connection = rtc.current;
    if (connection) {
      window.clearTimeout(connection.timer);
      for (const track of connection.tracks) track.stop();
      connection.audio.srcObject = null;
      connection.peer.close();
      rtc.current = undefined;
    }
    recognition.current?.abort();
    window.speechSynthesis?.cancel();
  }, []);

  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      cleanupPreview();
    };
  }, [cleanupPreview]);

  function speak(text: string, selected: VoiceChoice) {
    if (!window.speechSynthesis) return;
    const chosen = voices.find(({ id }) => id === selected) ?? voices[0];
    const available = window.speechSynthesis.getVoices().filter((item) => item.lang.toLowerCase().startsWith(chosen.language));
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = chosen.language === "es" ? "es-US" : "en-CA";
    utterance.voice = available[chosen.index] ?? available[0] ?? null;
    utterance.pitch = chosen.pitch;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  }

  async function start() {
    setMode("connecting");
    setError("");
    try {
      const result = await apiRequest<{ mode: "browser" | "realtime"; token?: string }>("onboarding/realtime", "POST", { voice });
      if (!active.current) return;
      if (result.mode === "browser" || !result.token) {
        setMode("browser");
        speak(setup.rules?.greeting ?? "Hello. How can I help you?", voice);
        return;
      }

      if (!navigator.mediaDevices?.getUserMedia || typeof RTCPeerConnection === "undefined") {
        throw new Error("Microphone access is unavailable. Try a written question below.");
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!active.current) {
        for (const track of stream.getTracks()) track.stop();
        return;
      }
      const peer = new RTCPeerConnection();
      const audio = new Audio();
      audio.autoplay = true;
      rtc.current = { peer, audio, tracks: stream.getTracks() };
      peer.ontrack = (event) => { audio.srcObject = event.streams[0]; };
      for (const track of stream.getAudioTracks()) peer.addTrack(track, stream);
      const channel = peer.createDataChannel("oai-events");
      channel.addEventListener("open", () => {
        if (!active.current) return;
        setMode("realtime");
        channel.send(JSON.stringify({
          type: "response.create", response: { instructions: `Greet the caller with this greeting: ${setup.rules?.greeting}` },
        }));
      });
      let responses = 0;
      channel.addEventListener("message", (event) => {
        try {
          const payload = JSON.parse(event.data) as { type?: string };
          if (payload.type === "response.done") {
            responses += 1;
            if (responses > 1 && active.current) setTested(true);
          }
        } catch { /* Ignore provider events without JSON. */ }
      });
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      const answer = await fetch("https://api.openai.com/v1/realtime/calls", {
        method: "POST", headers: { Authorization: `Bearer ${result.token}`, "Content-Type": "application/sdp" },
        body: offer.sdp, signal: AbortSignal.timeout(10_000),
      });
      if (!answer.ok) throw new Error("Voice couldn’t connect. Try a written question below.");
      await peer.setRemoteDescription({ type: "answer", sdp: await answer.text() });
      if (rtc.current) rtc.current.timer = window.setTimeout(() => {
        cleanupPreview();
        if (active.current) setMode("browser");
      }, 180_000);
      peer.addEventListener("connectionstatechange", () => {
        if (peer.connectionState === "failed" && active.current) {
          cleanupPreview();
          setMode("browser");
          setError("The voice connection ended. Try a written question below.");
        }
      });
    } catch (failure) {
      cleanupPreview();
      if (!active.current) return;
      setMode("browser");
      setError(failure instanceof Error && failure.name !== "NotAllowedError"
        ? failure.message : "Microphone access was declined. Try a written question below.");
    }
  }

  async function ask(text: string) {
    setSending(true);
    setError("");
    try {
      const result = await apiRequest<{ reply: string }>("onboarding/preview", "POST", { message: text });
      setTurn({ question: text, reply: result.reply });
      setTested(true);
      speak(result.reply, voice);
      setQuestion("");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Preview failed.");
    } finally { setSending(false); }
  }

  function listen() {
    const device = window as MicrophoneWindow;
    const SpeechRecognition = device.SpeechRecognition ?? device.webkitSpeechRecognition;
    if (!SpeechRecognition) { setError("Speech input is unavailable in this browser. Type your question below."); return; }
    window.speechSynthesis?.cancel();
    const input = new SpeechRecognition();
    input.lang = voice === "enrique" ? "es-US" : "en-CA";
    input.onresult = (event) => {
      const transcript = event.results[0]?.[0]?.transcript?.trim();
      if (transcript && active.current) void ask(transcript);
    };
    input.onerror = () => { if (active.current) setError("Couldn’t hear your question. You can type it below."); };
    input.onend = () => { if (active.current) setListening(false); };
    recognition.current = input;
    try { input.start(); setListening(true); } catch { setError("Couldn’t start your microphone."); }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (question.trim() && !sending) void ask(question.trim());
  }

  return (
    <div className="journey-preview">
      <h1 className="journey-preview-title">{setup.name}’s agent is ready</h1>
      <p className="journey-subtitle">Talk to it like a customer would. Transfers are off in this preview.</p>
      <AgentOrb rings />
      <fieldset className="journey-voices">
        <legend className="journey-visually-hidden">Voice</legend>
        {voices.map(({ id, label }) => (
          <button key={id} type="button" aria-pressed={voice === id} disabled={mode === "connecting" || mode === "realtime" || busy}
            onClick={() => {
              setVoice(id);
              speak(id === "enrique" ? "Hola, ¿en qué puedo ayudarle?" : setup.rules?.greeting ?? "Hello. How can I help you?", id);
            }}><Icon name="play" />{label}</button>
        ))}
      </fieldset>
      {(mode === "idle" || mode === "connecting") && (
        <button className="journey-primary journey-pill" type="button" onClick={() => void start()} disabled={mode === "connecting" || busy}>
          {mode === "connecting" ? "Connecting…" : "Talk to your agent"}
        </button>
      )}
      {mode === "realtime" && (
        <div className="journey-form">
          <p role="status">Microphone connected. Speak when ready.</p>
          <button type="button" className="journey-secondary" onClick={() => { cleanupPreview(); setMode("browser"); }}>End voice session</button>
        </div>
      )}
      {mode === "browser" && (
        <div className="journey-preview-panel">
          {turn && <div className="journey-conversation" aria-live="polite">
            <strong>You</strong><p>{turn.question}</p><strong>Receptionist</strong><p>{turn.reply}</p>
          </div>}
          <form className="journey-question" onSubmit={submit}>
            <input aria-label="Ask a question" placeholder="Ask about your hours or services" value={question}
              onChange={(event) => setQuestion(event.target.value)} maxLength={300} />
            <button type="submit" className="journey-secondary" disabled={!question.trim() || sending}>Send</button>
          </form>
          <button type="button" className="journey-text" disabled={listening || sending}
            onClick={listen}><Icon name="mic" />{listening ? "Listening…" : "Speak a question"}</button>
        </div>
      )}
      {error && <p role="alert" className="journey-error">{error}</p>}
      {tested && <button type="button" className="journey-primary journey-pill" disabled={busy}
        onClick={() => { cleanupPreview(); onDone(voice, false); }}>Continue to number</button>}
      <button type="button" className="journey-text" disabled={busy}
        onClick={() => { cleanupPreview(); onDone(voice, true); }}>Skip for now</button>
      {setup.profile && (
        <details className="journey-knowledge">
          <summary>See what your agent learned</summary>
          {setup.training && <p>{setup.training.pages.join(" · ")}</p>}
          {setup.training && (["services", "hours", "faqs"] as const).map((category) => {
            const facts = setup.training?.[category] ?? [];
            return facts.length > 0 && <div key={category}>
              <strong>{category === "faqs" ? "FAQs" : category === "hours" ? "Hours" : "Services"}</strong>
              <ul>{facts.map((fact) => <li key={fact}>{fact}</li>)}</ul>
            </div>;
          })}
          <div>{setup.profile.knowledge}</div>
        </details>
      )}
    </div>
  );
}
