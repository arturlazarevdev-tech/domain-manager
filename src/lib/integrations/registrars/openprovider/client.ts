import { createHash } from "node:crypto";
import { AppError } from "@/lib/errors";
import type { OpenproviderCredentials } from "./credentials";

type Token = { value: string; expiresAt: number };
const tokens = new Map<string, Promise<Token>>();

export class OpenproviderClient {
  private readonly key: string;
  constructor(private readonly credentials: OpenproviderCredentials) {
    this.key = createHash("sha256").update(JSON.stringify(credentials)).digest("hex");
  }
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
    const token = await this.token();
    try { return await this.send<T>(path, method, data, token); }
    catch (error) {
      // Only a definite authentication failure is replayed. Never retry a timed-out purchase.
      if (!(error instanceof AppError) || error.status !== 401) throw error;
      tokens.delete(this.key);
      return this.send<T>(path, method, data, await this.token());
    }
  }
  private error(message: string, status = 502, token?: string) {
    let safe = message;
    for (const value of [this.credentials.password, token]) {
      if (value) safe = safe.split(value).join("[redacted]");
    }
    return new AppError({ message: `Openprovider: ${safe}`, provider: "openprovider", status });
  }
  private async send<T>(path: string, method: "GET" | "POST" | "PUT", data?: Record<string, unknown>, token?: string): Promise<T> {
    const url = new URL(this.baseUrl + path);
    if (method === "GET") {
      for (const [key, value] of Object.entries(data ?? {})) {
        if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
      }
    }
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
    catch { throw this.error(`API returned an invalid response (HTTP ${response.status})`); }
    if (!response.ok || envelope.code !== 0) {
      throw this.error(envelope.desc || `API request failed (HTTP ${response.status}, code ${envelope.code ?? "unknown"})`, response.status === 401 ? 401 : response.ok ? 400 : 502, token);
    }
    if (envelope.data === undefined || envelope.data === null) {
      // Successful update calls may return no payload.
      if (method === "PUT") return {} as T;
      throw this.error("API response is missing data");
    }
    return envelope.data;
  }
}
