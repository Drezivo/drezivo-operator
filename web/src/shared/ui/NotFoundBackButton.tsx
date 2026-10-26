"use client";

import { ArrowLeft } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";

export function NotFoundBackButton() {
  const router = useRouter();
  return (
    <button type="button" className="pill-button pill-ghost" onClick={() => router.back()}>
      <ArrowLeft size={16} aria-hidden="true" />
      Go back
    </button>
  );
}
