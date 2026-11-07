"use client";

import { useEffect, useRef, useState } from "react";
import { apiBlobRequest } from "@/shared/api/client";
import { paymentPaths } from "@/features/payments/api";

export function ProofLightbox({ tenantId, paymentId, token, onClose }: {
  tenantId: string; paymentId: string; token: () => Promise<string>; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{ url: string; type: string } | "loading" | "error">("loading");

  useEffect(() => {
    const element = dialog.current;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    element?.showModal();
    return () => { element?.close(); previous?.focus(); };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let url: string | undefined;
    setState("loading");
    void (async () => {
      try {
        const blob = await apiBlobRequest(paymentPaths.proof(tenantId, paymentId), { token: await token(), signal: controller.signal });
        if (!['image/jpeg', 'image/png', 'image/webp', 'application/pdf'].includes(blob.type)) throw new Error('Unsupported proof format');
        if (controller.signal.aborted) return;
        url = URL.createObjectURL(blob);
        setState({ url, type: blob.type });
      } catch {
        if (!controller.signal.aborted) setState("error");
      }
    })();
    return () => { controller.abort(); if (url) URL.revokeObjectURL(url); };
  }, [tenantId, paymentId, token, attempt]);

  return <dialog ref={dialog} className="proof-lightbox" aria-labelledby="proof-title" onCancel={(event) => { event.preventDefault(); onClose(); }}>
    <div className="proof-lightbox-header"><h2 id="proof-title">Payment proof</h2><button type="button" className="table-action" onClick={onClose}>Close</button></div>
    {state === "loading" ? <p role="status">Loading proof…</p> : state === "error" ? <div role="alert"><p>Could not load this proof. Please try again.</p><button type="button" className="table-action" onClick={() => setAttempt((value) => value + 1)}>Try again</button></div>
      : state.type === "application/pdf" ? <iframe title="Payment proof PDF" src={state.url} className="proof-lightbox-pdf" />
        : <img src={state.url} alt="Payment proof" className="proof-lightbox-image" />}
  </dialog>;
}
