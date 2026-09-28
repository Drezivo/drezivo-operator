import { useState } from "react";
import { ArrowClockwise, CircleNotch, MagnifyingGlass, WarningCircle } from "@phosphor-icons/react";
import { ApiError } from "@/lib/api";

export function RequestId({ requestId }: { requestId: string }) {
  const [copyState, setCopyState] = useState("");

  const copy = async () => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(requestId);
      setCopyState("Copied");
    } catch {
      setCopyState("Select the ID to copy");
    }
  };

  return <span className="request-id"><span>Request ID</span><code>{requestId}</code><button type="button" className="text-button" onClick={() => void copy()}>Copy</button>{copyState && <span role="status">{copyState}</span>}</span>;
}

export function StatePanel({ error, dependency, onRetry }: { error: ApiError; dependency?: "Business API" | "Clerk operator directory"; onRetry: () => void }) {
  const dependencyInvalid = error.code === "DEPENDENCY_INVALID_RESPONSE" && dependency;
  const dependencyUnavailable = error.kind === "unavailable" && dependency && !dependencyInvalid;
  const copy = error.code === "API_BASE_NOT_CONFIGURED"
    ? { title: "Operator API address required", body: error.message }
    : error.code === "API_BASE_INVALID"
      ? { title: "Operator API address is invalid", body: error.message }
      : error.kind === "unauthorized"
    ? { title: "Your session needs attention", body: "Sign in again to continue. No data was loaded for this request." }
    : error.kind === "forbidden"
      ? { title: "Operator access not granted", body: "The API denied this request. Ask an administrator to confirm your operator membership and access scope." }
      : error.kind === "unavailable"
        ? dependencyInvalid
            ? { title: `${dependency} returned data we could not verify`, body: `This view depends on ${dependency}, but its response failed validation. Try again. If the problem continues, share the request ID with your internal support team.` }
            : dependencyUnavailable
              ? { title: `${dependency} could not provide this view`, body: `This view needs data from ${dependency}. Try again. If the problem continues, share the request ID with your internal support team.` }
              : { title: "This request is temporarily unavailable", body: "The Operator API could not complete this request. Try again. If the problem continues, share the request ID with your internal support team." }
        : error.kind === "network"
          ? { title: "Could not reach the operator API", body: error.message }
          : { title: "We could not load this view", body: error.message };
  return <section className={`state-panel ${error.kind === "forbidden" ? "state-denied" : ""}`} role="alert"><span className="state-icon"><WarningCircle size={23} weight="duotone" /></span><div><h2>{copy.title}</h2><p>{copy.body}</p>{error.requestId && <small>Request ID: {error.requestId}</small>}</div><button className="button button-secondary" onClick={onRetry}><ArrowClockwise size={16} /> Try again</button></section>;
}

export function LoadingPanel() { return <div className="loading-panel" role="status"><CircleNotch className="spin" size={20} /><span>Loading from operator API…</span></div>; }

export function EmptyPanel({ title = "No records returned", body = "The API returned an empty collection for this view." }: { title?: string; body?: string }) {
  return <div className="empty-panel"><span className="empty-icon"><MagnifyingGlass size={20} /></span><h2>{title}</h2><p>{body}</p></div>;
}
