import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import Redis from "ioredis";
import { AppError } from "@/lib/errors";

export type RequestKind = "registration" | "check" | "auth" | "other";
const defaults = { spacing: 1100, registration: 25000, check: 16000, auth: 2200, lease: 120000, concurrency: 2 };
type Policy = typeof defaults;
const reserveScript = `
local t = redis.call('TIME')
local now = t[1]*1000 + math.floor(t[2]/1000)
local blocked = tonumber(redis.call('GET', KEYS[1]) or '0')
if blocked > now then return {-1, blocked-now} end
redis.call('ZREMRANGEBYSCORE', KEYS[2], '-inf', now)
if redis.call('ZCARD', KEYS[2]) >= tonumber(ARGV[5]) then return {0, 250} end
local ready = math.max(tonumber(redis.call('GET', KEYS[3]) or '0'), tonumber(redis.call('GET', KEYS[4]) or '0'))
if ready > now then return {0, ready-now} end
redis.call('ZADD', KEYS[2], now+tonumber(ARGV[4]), ARGV[1])
redis.call('PEXPIRE', KEYS[2], ARGV[4])
redis.call('SET', KEYS[3], now+tonumber(ARGV[2]), 'PX', 300000)
redis.call('SET', KEYS[4], now+tonumber(ARGV[3]), 'PX', 300000)
return {1, 0}`;
const blockScript = `
local t = redis.call('TIME')
local now = t[1]*1000 + math.floor(t[2]/1000)
local untilTime = math.max(tonumber(redis.call('GET', KEYS[1]) or '0'), now+tonumber(ARGV[1]))
redis.call('SET', KEYS[1], untilTime, 'PX', untilTime-now)
return untilTime`;

export class OpenproviderRateLimitError extends AppError {
  constructor(public readonly waitMs: number) {
    super({ message: `Openprovider API is temporarily paused after a rate limit. Retry in ${Math.ceil(waitMs / 1000)} seconds.`, provider: "openprovider", status: 429, retryable: true });
  }
}

export class OpenproviderRateLimiter {
  private memory = new Map<string, { blocked: number; next: number; slots: Map<string, number>; leases: Map<string, number> }>();
  constructor(private redis?: Redis, private policy: Policy = defaults) {}
  private state(key: string) {
    let state = this.memory.get(key);
    if (!state) { state = { blocked: 0, next: 0, slots: new Map(), leases: new Map() }; this.memory.set(key, state); }
    return state;
  }
  async acquire(key: string, kind: RequestKind, fingerprint: string) {
    const prefix = `openprovider:api:${key}`, token = randomUUID();
    const slot = kind === "registration" ? "registration" : kind === "check" ? `check:${fingerprint}` : kind === "auth" ? "auth" : "other";
    const interval = kind === "registration" ? this.policy.registration : kind === "check" ? this.policy.check : kind === "auth" ? this.policy.auth : this.policy.spacing;
    for (;;) {
      let decision: number[];
      if (this.redis) {
        decision = await this.redis.eval(reserveScript, 4, `${prefix}:blocked`, `${prefix}:leases`, `${prefix}:next`, `${prefix}:${slot}`, token, this.policy.spacing, interval, this.policy.lease, this.policy.concurrency) as number[];
      } else {
        const s = this.state(key), now = Date.now();
        for (const [id, expiry] of s.leases) if (expiry <= now) s.leases.delete(id);
        const wait = Math.max(s.next, s.slots.get(slot) ?? 0) - now;
        if (s.blocked > now) decision = [-1, s.blocked - now];
        else if (s.leases.size >= this.policy.concurrency) decision = [0, 250];
        else if (wait > 0) decision = [0, wait];
        else { s.leases.set(token, now + this.policy.lease); s.next = now + this.policy.spacing; s.slots.set(slot, now + interval); decision = [1, 0]; }
      }
      if (decision[0] === -1) throw new OpenproviderRateLimitError(decision[1]);
      if (decision[0] === 1) return async () => {
        if (this.redis) await this.redis.zrem(`${prefix}:leases`, token);
        else this.state(key).leases.delete(token);
      };
      await delay(Math.min(decision[1], 1000));
    }
  }
  async block(key: string, ms: number) {
    if (this.redis) await this.redis.eval(blockScript, 1, `openprovider:api:${key}:blocked`, ms);
    else { const s = this.state(key); s.blocked = Math.max(s.blocked, Date.now() + ms); }
  }
}

let shared: OpenproviderRateLimiter | undefined;
function limiter() {
  if (!shared) {
    const redis = process.env.REDIS_URL ? new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: 1, commandTimeout: 5000, connectTimeout: 5000, retryStrategy: () => null }) : undefined;
    redis?.on("error", () => {});
    shared = new OpenproviderRateLimiter(redis);
  }
  return shared;
}
// A single Redis policy coordinates web requests and all purchase workers.
export const openproviderRateLimit = {
  acquire: (key: string, kind: RequestKind, fingerprint: string) => limiter().acquire(key, kind, fingerprint),
  block: (key: string, ms: number) => limiter().block(key, ms),
};
