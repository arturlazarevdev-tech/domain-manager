import { createHash, createHmac, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { AppError } from "@/lib/errors";
import type { DynadotCredentials } from "./credentials";

// Regular accounts permit one concurrent request. Share the queue across adapters.
const queues = new Map<string, { tail: Promise<unknown>; started: number }>();

export class DynadotClient {
  private readonly queueKey: string;
  constructor(private readonly credentials: DynadotCredentials) {
    this.queueKey = createHash("sha256").update(JSON.stringify(credentials)).digest("hex");
  }

  async request<T>(path: string, method: "GET" | "POST" | "PUT" = "GET", data: Record<string, unknown> = {}): Promise<T> {
    let queue = queues.get(this.queueKey);
    if (!queue) {
      queue = { tail: Promise.resolve(), started: 0 };
      queues.set(this.queueKey, queue);
    }
    const shared = queue;
    const result = shared.tail.catch(() => {}).then(async () => {
      await delay(Math.max(0, shared.started + 1050 - Date.now()));
      shared.started = Date.now();
      return this.send<T>(path, method, data);
    });
    shared.tail = result.then(() => {}, () => {});
    return result;
  }

  private async send<T>(path: string, method: "GET" | "POST" | "PUT", data: Record<string, unknown>): Promise<T> {
    const host = this.credentials.sandbox ? "https://api-sandbox.dynadot.com" : "https://api.dynadot.com";
    const url = new URL(`/restful/v2${path}`, host);
    if (method === "GET") {
      for (const [key, value] of Object.entries(data)) {
        if (value !== undefined && value !== null) url.searchParams.set(key, Array.isArray(value) ? value.join(",") : String(value));
      }
    }
    const body = method === "GET" ? "" : JSON.stringify(data);
    const requestId = randomUUID();
    const signature = createHmac("sha256", this.credentials.apiSecret)
      .update([this.credentials.apiKey, url.pathname + url.search, requestId, body].join("\n")).digest("base64");
    const uncertain = method === "POST" && path.endsWith("/register");
    const fail = (message: string, status = 502) => {
      let safe = message;
      for (const value of [this.credentials.apiKey, this.credentials.apiSecret, signature]) safe = safe.split(value).join("[redacted]");
      return new AppError({ provider: "dynadot", status, message: `Dynadot: ${safe}${uncertain ? " Check the domain and order in Dynadot before retrying registration." : ""}` });
    };
    let response: Response;
    try {
      response = await fetch(url, {
        method, headers: { Accept: "application/json", "Content-Type": "application/json", Authorization: `Bearer ${this.credentials.apiKey}`, "X-Request-ID": requestId, "X-Signature": signature },
        body: body || undefined, cache: "no-store", signal: AbortSignal.timeout(65000),
      });
    } catch {
      throw fail("API request failed or timed out.");
    }
    let result: { code?: number; message?: string; error?: { description?: string }; data?: T };
    try { result = await response.json(); }
    catch { throw fail(`Invalid API response (HTTP ${response.status}).`); }
    if (!response.ok || !Number.isInteger(result.code) || result.code! < 200 || result.code! >= 300 || result.error) {
      throw fail(result.error?.description || result.message || `API request failed (HTTP ${response.status}).`, response.status === 429 || result.code === 429 ? 429 : 502);
    }
    if (result.data === undefined && method !== "PUT") throw fail("API response is missing data.");
    return (result.data ?? {}) as T;
  }
}
