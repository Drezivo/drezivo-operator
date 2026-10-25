"use client";

import { createContext, useContext, useEffect, type Dispatch, type SetStateAction } from "react";
import { usePathname } from "next/navigation";

export type ConsoleControls = { key: string; refresh: () => Promise<void>; pending: boolean };
export const ConsoleControlsContext = createContext<{
  setControls: Dispatch<SetStateAction<ConsoleControls | null>>;
  rememberSidebarScroll: () => void;
}>({ setControls: () => undefined, rememberSidebarScroll: () => undefined });

export function useConsoleNavigation() {
  return useContext(ConsoleControlsContext).rememberSidebarScroll;
}

/** A mounted feature can supply the shell's refresh control without owning the shell. */
export function useConsoleRefresh(refresh: () => Promise<void>, pending: boolean) {
  const { setControls } = useContext(ConsoleControlsContext);
  const pathname = usePathname();
  useEffect(() => {
    const controls = { key: pathname, refresh, pending };
    setControls(controls);
    return () => setControls((current) => current === controls ? null : current);
  }, [setControls, pathname, refresh, pending]);
}
