import { z } from "zod";
import { AppError } from "@/lib/errors";
import type { HestiaDomain, HestiaProvider } from "@/lib/integrations/types";

export const hestiaCredentialsSchema = z.object({
  accessKey: z.string().min(1),
  secretKey: z.string().min(1),
  user: z.string().min(1).optional(),
});

export type HestiaCredentials = z.infer<typeof hestiaCredentialsSchema>;

const HESTIA_CODES: Record<number, string> = {
  0: "OK",
  1: "Not enough arguments provided",
  2: "Object or argument is not valid",
  3: "Object does not exist",
  4: "Object already exists",
  8: "Hosting package limit reached",
  9: "Wrong / invalid password",
  10: "Access forbidden",
};

export class HestiaAdapter implements HestiaProvider {
  constructor(
    private baseUrl: string,
    private credentials: HestiaCredentials,
  ) {}

  async testConnection() {
    try {
      await this.call(this.credentials.user ? "v-list-web-domains" : "v-list-sys-info", this.credentials.user ? [this.credentials.user, "json"] : ["json"]);
      return { ok: true as const };
    } catch (error) {
      return {
        ok: false as const,
        message: error instanceof Error ? error.message : "Hestia connection failed",
      };
    }
  }

  async listUsers() {
    if (this.credentials.user) return [this.credentials.user];
    const data = await this.call<Record<string, unknown>>("v-list-users", ["json"]);
    if (typeof data === "string") return [data];
    return Object.keys(data ?? {});
  }

  async listIps(user: string): Promise<string[]> {
    try {
      const data = await this.call<Record<string, unknown>>("v-list-user-ips", [user, "json"]);
      if (data && typeof data === "object") return Object.keys(data);
    } catch {
      // fall through to system IPs
    }
    try {
      const data = await this.call<Record<string, unknown>>("v-list-sys-ips", ["json"]);
      if (data && typeof data === "object") return Object.keys(data);
    } catch {
      return [];
    }
    return [];
  }

  async addWebDomain(user: string, domain: string, ip?: string | null): Promise<HestiaDomain> {
    const args = ip ? [user, domain, ip, "no"] : [user, domain];
    const result = await this.call<string>("v-add-web-domain", args);
    if (Number(result.trim()) === 4 && ip) await this.call("v-change-web-domain-ip", [user, domain, ip, "yes"]);
    return { name: domain, user, ip: ip ?? undefined };
  }

  private async call<T = unknown>(cmd: string, args: string[] = []): Promise<T> {
    const body = new URLSearchParams();
    body.set("hash", `${this.credentials.accessKey}:${this.credentials.secretKey}`);
    body.set("cmd", cmd);
    body.set("returncode", cmd.startsWith("v-list") ? "no" : "yes");
    args.forEach((arg, index) => body.set(`arg${index + 1}`, arg));

    const response = await fetch(`${this.baseUrl.replace(/\/$/, "")}/api/`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });
    const text = await response.text();

    if (!response.ok) {
      throw new AppError({
        message: "Hestia request failed",
        provider: "hestia",
        details: text || `HTTP ${response.status}`,
        status: 502,
        retryable: true,
      });
    }

    if (cmd.startsWith("v-list") && !/^\d+$/.test(text.trim())) {
      try {
        const data: unknown = JSON.parse(text);
        if (data && typeof data === "object") return data as T;
      } catch { /* Invalid responses must not indicate a successful connection. */ }
      throw new AppError({ message: "Hestia returned an invalid response", provider: "hestia", status: 502 });
    }

    const code = /^\d+$/.test(text.trim()) ? Number(text.trim()) : NaN;
    if (!Number.isFinite(code) || cmd.startsWith("v-list") || (code !== 0 && !(code === 4 && cmd === "v-add-web-domain"))) {
      throw new AppError({
        message: `Hestia could not complete ${cmd}`,
        provider: "hestia",
        details: HESTIA_CODES[code] ?? "Unexpected Hestia response",
        status: 400,
        retryable: code >= 13,
      });
    }

    return text as T;
  }
}
