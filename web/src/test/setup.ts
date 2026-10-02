import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";

// The view cache is module state; each test starts as a fresh browser tab. Imported lazily so a
// test file's vi.mock of the API client still applies to the cache module it loads.
afterEach(async () => (await import("@/lib/view-cache")).clearViewCache());
