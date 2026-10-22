import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { openproviderRateLimit, OpenproviderRateLimitError } from "./rate-limit";
import { openproviderRequestContext } from "./context";
import { AppError } from "@/lib/errors";
import type { OpenproviderCredentials } from "./credentials";

type Token = { value: string; expiresAt: number };
const tokens = new Map<string, Promise<Token>>();

export class OpenproviderClient {
  private readonly key: string;
  constructor(private readonly credentials: OpenproviderCredentials) {
    this.key = createHash("sha256").update(JSON.stringify(credentials)).digest("hex");
  }
  private get rateKey() { return createHash("sha256").update(`${this.baseUrl}:${this.credentials.username.trim().toLowerCase()}`).digest("hex"); }
  get baseUrl() {
    return this.credentials.sandbox ? "https://api.sandbox.openprovider.nl/v1beta" : "https://api.openprovider.eu/v1";
  }
  private async token(): Promise<string> {
    const cached = tokens.get(this.key);
    if (cached) {
      const token = await cached;
      if (token.expiresAt > Date.now()) return token.value;
      tokens.delete(this.key);
    }
    const pending = this.send<{ token: string }>("/auth/login", "POST", {
      username: this.credentials.username, password: this.credentials.password, ip: "0.0.0.0",
    }).then((data) => {
      if (!data.token) throw this.error("Authentication did not return a token");
      // Official tokens last 48 hours. Refresh earlier and also handle HTTP 401.
      return { value: data.token, expiresAt: Date.now() + 60 * 60 * 1000 };
    });
    tokens.set(this.key, pending);
    try { return (await pending).value; }
    catch (error) { tokens.delete(this.key); throw error; }
  }
  async request<T>(path: string, method: "GET" | "POST" | "PUT" = "GET", data?: Record<string, unknown>): Promise<T> {
    const safeToRetry = method === "GET" || method === "PUT" || path === "/domains/check";
    let refreshed = false;
    for (let attempt = 0; ; attempt++) {
      try {
        const token = await this.token();
        try { return await this.send<T>(path, method, data, token); }
        catch (error) {
          if (!(error instanceof AppError) || error.status !== 401 || refreshed) throw error;
          refreshed = true;
          tokens.delete(this.key);
          return await this.send<T>(path, method, data, await this.token());
        }
      } catch (error) {
        if (error instanceof OpenproviderRateLimitError && openproviderRequestContext.getStore() && safeToRetry && attempt < 3) {
          await this.waitForLimit(error.waitMs); continue;
        }
        if (safeToRetry && attempt < 2 && error instanceof AppError && error.retryable && error.status !== 429) {
          await delay(attempt === 0 ? 2000 : 5000); continue;
        }
        throw error;
      }
    }
  }
  private async waitForLimit(ms: number) {
    const context = openproviderRequestContext.getStore();
    await context?.onWait(ms);
    await delay(Math.min(ms, 30000));
  }

  private error(message: string, status = 502, token?: string) {
    let safe = message;
    for (const value of [this.credentials.password, token]) {
      if (value) safe = safe.split(value).join("[redacted]");
    }
    return new AppError({ message: `Openprovider: ${safe}`, provider: "openprovider", status, retryable: status === 502 || status === 503 });
  }
  private async send<T>(path: string, method: "GET" | "POST" | "PUT", data?: Record<string, unknown>, token?: string): Promise<T> {
    const url = new URL(this.baseUrl + path);
    if (method === "GET") {
      for (const [key, value] of Object.entries(data ?? {})) {
        if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
      }
    }
    const fingerprint = createHash("sha256").update(JSON.stringify([path, data])).digest("hex");
    let release: () => Promise<unknown>;
    for (;;) {
      try { release = await openproviderRateLimit.acquire(this.rateKey, method === "POST" && path === "/domains" ? "registration" : path === "/domains/check" ? "check" : path === "/auth/login" ? "auth" : "other", fingerprint); break; }
      catch (error) {
        if (error instanceof OpenproviderRateLimitError) {
          if (!openproviderRequestContext.getStore()) throw error;
          await this.waitForLimit(error.waitMs); continue;
        }
        throw this.error("Request queue is unavailable. No API request was submitted. Try again later.", 503);
      }
    }
    try {
      let response: Response;
      const registration = method === "POST" && path === "/domains";
      try {
        response = await fetch(url, {
          method, headers: { "Content-Type": "application/json", Accept: "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          body: method === "GET" ? undefined : JSON.stringify(data ?? {}), cache: "no-store", signal: AbortSignal.timeout(registration ? 90000 : 30000),
        });
      } catch {
        throw this.error(registration
          ? "Registration response was not received. Check the domain in Openprovider before retrying."
          : "API request failed or timed out");
      }
      let envelope: { code?: number; data?: T; desc?: string };
      try { envelope = await response.json(); }
      catch {
        if (response.status === 429) { await openproviderRateLimit.block(this.rateKey, 300000); throw new OpenproviderRateLimitError(300000); }
        throw this.error(registration ? "Registration response was not received. Check the domain in Openprovider before retrying." : `API returned an invalid response (HTTP ${response.status})`);
      }
      if (!response.ok || envelope.code !== 0) {
        if (response.status === 429 || envelope.code === 4007 || /temporarily blocked because of excessive use|calls limit has been reached/i.test(envelope.desc ?? "")) {
          const retryAfter = response.headers.get("Retry-After");
          const parsed = retryAfter && /^\d+$/.test(retryAfter) ? Number(retryAfter) * 1000 : retryAfter ? Date.parse(retryAfter) - Date.now() : 0;
          const cooldown = Math.max(300000, Number.isFinite(parsed) ? parsed : 0);
          await openproviderRateLimit.block(this.rateKey, cooldown);
          throw new OpenproviderRateLimitError(cooldown);
        }
        throw this.error(envelope.desc || `API request failed (HTTP ${response.status}, code ${envelope.code ?? "unknown"})`, response.status >= 400 && response.status < 500 ? response.status : response.ok ? 400 : 502, token);
      }
      if (envelope.data === undefined || envelope.data === null) {
        // Successful update calls may return no payload.
        if (method === "PUT") return {} as T;
        throw this.error(registration ? "Registration response was not received. Check the domain in Openprovider before retrying." : "API response is missing data");
      }
      return envelope.data;
    } finally { await release().catch(() => {}); }
  }
}
