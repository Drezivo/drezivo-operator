"use client";

import { useCallback } from "react";
import { ApiError } from "@/shared/api/client";
import { useOperatorAuth } from "./local-auth";
import { getTokenWithTimeout } from "./token";

export function useSessionToken() {
  const { getToken } = useOperatorAuth();
  return useCallback(async (signal?: AbortSignal) => {
    const token = await getTokenWithTimeout(getToken, signal);
    if (!token) throw new ApiError("The operator session could not be verified.", "unauthorized");
    return token;
  }, [getToken]);
}
