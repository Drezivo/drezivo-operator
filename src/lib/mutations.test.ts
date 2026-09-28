import { describe, expect, it, vi } from "vitest";
import { MutationGuard } from "./mutations";

describe("mutation intent keys", () => {
  it("blocks concurrent submits and replays the same key after a failed request", async () => {
    const guard = new MutationGuard();
    const firstKey: string[] = [];
    let failRequest!: (error: Error) => void;
    const firstRequest = guard.run("job:retry:1", { reason: "Investigated failure" }, (key) => {
      firstKey.push(key);
      return new Promise<string>((_resolve, reject) => { failRequest = reject; });
    });
    expect(guard.isPending).toBe(true);
    const duplicateRequest = vi.fn(async () => "duplicate");
    const duplicate = await guard.run("job:retry:1", { reason: "Investigated failure" }, duplicateRequest);
    expect(duplicate).toBeUndefined();
    expect(duplicateRequest).not.toHaveBeenCalled();
    failRequest(new Error("connection lost"));
    await expect(firstRequest).rejects.toThrow("connection lost");
    const retry = vi.fn(async (key: string) => key);
    const replayedKey = await guard.run("job:retry:1", { reason: "Investigated failure" }, retry);
    expect(retry).toHaveBeenCalledOnce();
    expect(replayedKey).toBe(firstKey[0]);
    expect(guard.isPending).toBe(false);
  });
});
