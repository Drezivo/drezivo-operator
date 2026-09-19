import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { AppError } from './errors.js';

export interface RateLimitStore {
  consume(key: string, now: number): { allowed: boolean; retryAfterSeconds: number };
}

export interface RateLimitOptions {
  limit?: number;
  windowMs?: number;
  maxKeys?: number;
  store?: RateLimitStore;
  key?: (req: Request) => string;
}

type Bucket = { count: number; expiresAt: number; lastSeen: number };

/** Small default store for a single process. Production must provide a shared store. */
export class InMemoryRateLimitStore implements RateLimitStore {
  private readonly buckets = new Map<string, Bucket>();
  constructor(private readonly limit: number, private readonly windowMs: number, private readonly maxKeys: number) {}

  consume(key: string, now: number): { allowed: boolean; retryAfterSeconds: number } {
    this.cleanup(now);
    const current = this.buckets.get(key);
    const bucket = current && current.expiresAt > now ? current : { count: 0, expiresAt: now + this.windowMs, lastSeen: now };
    bucket.lastSeen = now;
    bucket.count += 1;
    this.buckets.set(key, bucket);
    this.cleanup(now);
    const retryAfterSeconds = Math.max(1, Math.ceil((bucket.expiresAt - now) / 1000));
    return { allowed: bucket.count <= this.limit, retryAfterSeconds };
  }

  get size(): number { return this.buckets.size; }

  private cleanup(now: number): void {
    for (const [key, bucket] of this.buckets) if (bucket.expiresAt <= now) this.buckets.delete(key);
    if (this.buckets.size <= this.maxKeys) return;
    const oldest = [...this.buckets.entries()].sort((a, b) => a[1].lastSeen - b[1].lastSeen);
    for (const [key] of oldest.slice(0, this.buckets.size - this.maxKeys)) this.buckets.delete(key);
  }
}

export function createRateLimitMiddleware(options: RateLimitOptions = {}): RequestHandler {
  const limit = options.limit ?? 60;
  const windowMs = options.windowMs ?? 60_000;
  const maxKeys = options.maxKeys ?? 10_000;
  if (!Number.isInteger(limit) || limit < 1 || !Number.isFinite(windowMs) || windowMs < 1 || !Number.isInteger(maxKeys) || maxKeys < 1) {
    throw new Error('Invalid rate-limit configuration.');
  }
  const store = options.store ?? new InMemoryRateLimitStore(limit, windowMs, maxKeys);
  const key = options.key ?? ((req: Request) => req.ip || req.socket.remoteAddress || 'unknown');
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = store.consume(key(req), Date.now());
    if (result.allowed) { next(); return; }
    res.setHeader('Retry-After', String(result.retryAfterSeconds));
    next(new AppError(429, 'RATE_LIMITED', 'Too many requests. Please try again later.'));
  };
}
