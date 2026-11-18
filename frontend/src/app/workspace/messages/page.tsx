import Link from "next/link";
import { redirect } from "next/navigation";
import { sessionRequest } from "@/features/auth/session-request";

interface Message { id: string; callbackNumber: string | null; message: string; receivedAt: string }

export default async function MessagesPage() {
  const response = await sessionRequest("onboarding/messages").catch(() => null);
  if (response === undefined || response?.status === 401) redirect("/");
  const messages: Message[] | undefined = response?.ok ? await response.json() : undefined;
  const dates = new Intl.DateTimeFormat("en-CA", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" });

  return (
    <main className="workspace">
      <Link className="secondary action-link workspace-setup-link" href="/workspace">Back to workspace</Link>
      <div className="workspace-title"><h1>Caller messages</h1></div>
      {!messages ? <p>Messages are unavailable for this workspace.</p> : !messages.length ? (
        <section className="settings"><p>Messages from your receptionist will appear here after callers leave one.</p></section>
      ) : (
        <ul className="caller-messages">
          {messages.map(({ id, callbackNumber, message, receivedAt }) => (
            <li key={id} className="settings">
              <strong>{callbackNumber ?? "Caller ID unavailable"}</strong>
              <time dateTime={receivedAt}>{dates.format(new Date(receivedAt))} UTC</time>
              <p>{message}</p>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
