"use client";

import { useCallback, useRef, useState, type FormEvent } from "react";
import { ApiError, apiRequest } from "@/shared/api/client";
import { MutationGuard } from "@/shared/api/mutations";
import { useCachedLoad } from "@/shared/api/view-cache";
import { getTokenWithTimeout } from "@/shared/auth/token";
import { formatManila } from "@/shared/lib/format";
import { EmptyPanel, LoadingPanel, RequestId, StatePanel } from "@/shared/ui/StatePanels";
import { BODY_MAX, SUBJECT_MAX, announcementPaths, type Announcement, type SentAnnouncement } from "../model";

/**
 * Email every client business at once, for maintenance windows and product updates. The business
 * worker sends one email per business to its contact address. Sending asks for confirmation, and a
 * retry of the same message reuses its idempotency key, so a double click never sends twice.
 */
export function AnnouncementsPanel({ getToken }: { getToken: () => Promise<string | null> }) {
  const token = useCallback(async (signal?: AbortSignal) => {
    const value = await getTokenWithTimeout(getToken, signal);
    if (!value) throw new ApiError("The operator session could not be verified.", "unauthorized");
    return value;
  }, [getToken]);
  const [history, reload] = useCachedLoad<{ items: Announcement[] }>(announcementPaths.list, token);
  const guard = useRef(new MutationGuard());
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [notice, setNotice] = useState<{ message: string; requestId: string } | null>(null);
  const ready = subject.trim().length > 0 && body.trim().length > 0;

  async function send(event: FormEvent) {
    event.preventDefault();
    if (!ready || sending || guard.current.isPending) return;
    if (!confirming) {
      setConfirming(true);
      return;
    }
    const payload = { subject: subject.trim(), body: body.trim() };
    setError(null);
    setSending(true);
    try {
      const result = await guard.current.run("announcement", payload, async (idempotencyKey) =>
        apiRequest<SentAnnouncement>(announcementPaths.send, { method: "POST", token: await token(), body: payload, idempotencyKey }));
      if (!result) return;
      const count = result.data.recipient_count;
      setNotice({ message: `Sending "${result.data.subject}" to ${count} ${count === 1 ? "business" : "businesses"}.`, requestId: result.requestId });
      setSubject("");
      setBody("");
      setConfirming(false);
      void reload();
    } catch (sendError) {
      setError(sendError instanceof ApiError ? sendError : new ApiError("An unexpected error occurred.", "http"));
    } finally {
      setSending(false);
    }
  }

  const edit = (apply: () => void) => {
    apply();
    setConfirming(false);
  };

  return <div className="clients announcements">
    <section className="panel">
      <form className="action-form" onSubmit={(event) => void send(event)}>
        <label>Subject<span className="field-hint">Shown as the email subject</span>
          <input value={subject} maxLength={SUBJECT_MAX} disabled={sending} placeholder="Scheduled maintenance on Sunday"
            onChange={(event) => edit(() => setSubject(event.target.value))} />
        </label>
        <label>Message<span className="field-hint">Plain text. Each business is greeted by name, and a line saying it is a Drezivo service message is added at the end.</span>
          <textarea rows={8} value={body} maxLength={BODY_MAX} disabled={sending} onChange={(event) => edit(() => setBody(event.target.value))} />
        </label>
        {error && <StatePanel error={error} dependency="Business API" onRetry={() => setError(null)} />}
        {confirming && <p className="field-hint" role="alert">This emails every business that is not closed, at its contact email. Businesses without one are skipped. Send now?</p>}
        <span className="row-actions">
          {confirming && <button type="button" className="text-button" disabled={sending} onClick={() => setConfirming(false)}>Cancel</button>}
          <button type="submit" className="button button-primary" disabled={!ready || sending}>
            {sending ? "Sending…" : confirming ? "Send to all businesses" : "Review and send"}
          </button>
        </span>
      </form>
    </section>
    {notice && <p className="action-success" role="status">{notice.message}<RequestId requestId={notice.requestId} /></p>}
    <h2 className="eyebrow">Sent</h2>
    {history.status === "error" ? <StatePanel error={history.error} dependency="Business API" onRetry={() => void reload()} />
      : history.status === "loading" ? <LoadingPanel />
        : history.data.items.length === 0 ? <EmptyPanel title="No announcements yet" body="Messages you send appear here with their delivery progress." />
          : <ul className="data-list" aria-label="Sent announcements">
            {history.data.items.map((item) => <li key={item.id} className="data-row">
              <dl className="row-fields">
                <div><dt>Subject</dt><dd>{item.subject}</dd></div>
                <div><dt>Sent</dt><dd>{formatManila(item.created_at, true)}</dd></div>
                <div><dt>Delivery</dt><dd>{item.delivered} of {item.recipient_count} done{item.queued > 0 ? ` · ${item.queued} in progress` : ""}{item.failed > 0 ? ` · ${item.failed} failed` : ""}</dd></div>
              </dl>
            </li>)}
          </ul>}
  </div>;
}
