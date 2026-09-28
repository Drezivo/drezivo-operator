export type IntentKeyRecord = { fingerprint: string; key: string };
export type IntentKeyStore = Map<string, IntentKeyRecord>;

export function idempotencyKeyFor(store: IntentKeyStore, intent: string, payload: unknown): string {
  const fingerprint = JSON.stringify(payload);
  const previous = store.get(intent);
  if (previous?.fingerprint === fingerprint) return previous.key;
  const key = crypto.randomUUID();
  store.set(intent, { fingerprint, key });
  return key;
}

export function completeIntent(store: IntentKeyStore, intent: string): void {
  store.delete(intent);
}

export class MutationGuard {
  private pending = false;
  private readonly intents: IntentKeyStore = new Map();

  get isPending() { return this.pending; }

  async run<T>(intent: string, payload: unknown, request: (idempotencyKey: string) => Promise<T>): Promise<T | undefined> {
    if (this.pending) return undefined;
    this.pending = true;
    const key = idempotencyKeyFor(this.intents, intent, payload);
    try {
      const result = await request(key);
      completeIntent(this.intents, intent);
      return result;
    } finally {
      this.pending = false;
    }
  }
}
