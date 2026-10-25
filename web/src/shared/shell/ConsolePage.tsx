"use client";

import { useLayoutEffect, useRef, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { WarningCircle } from "@phosphor-icons/react";
import { enabledResourceIds, resources, resourceHelp, type ResourceId } from "@/shared/navigation/resources";

/** Availability is checked before mounting feature children or issuing their API requests. */
export function ConsolePage({ feature, title, description, picker, children }: {
  feature: ResourceId; title?: string; description?: string; picker?: ReactNode; children: ReactNode;
}) {
  const resource = resources.find((item) => item.id === feature)!;
  const available = enabledResourceIds().includes(feature);
  const pathname = usePathname();
  const heading = useRef<HTMLHeadingElement>(null);
  useLayoutEffect(() => { heading.current?.focus(); }, [pathname]);
  return <>
    <div className="page-heading"><div>
      <p className="eyebrow">{available ? resource.group : "Navigation"}</p>
      <h1 ref={heading} tabIndex={-1}>{available ? title ?? resource.label : "Unsupported view"}</h1>
      <p className="page-description">{available ? description ?? resourceHelp[feature] : "This view is not enabled in this console. Choose a view from the navigation."}</p>
    </div>{available && picker}</div>
    {available ? children : <div className="blocked-panel" role="alert"><span className="blocked-mark"><WarningCircle size={21} /></span><div><span className="eyebrow">Request rejected</span><h2>This console view is not supported</h2><p>Select a supported view from the navigation. No operator API request was made.</p></div></div>}
  </>;
}
