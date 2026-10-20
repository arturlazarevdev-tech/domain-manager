import { z } from "zod";
import { AppError } from "@/lib/errors";
import { cloudflareZoneLimit } from "./limits";
import type { CloudflareProvider, CloudflareZone } from "@/lib/integrations/types";

export const cloudflareCredentialsSchema = z.object({
  apiToken: z.string().min(1),
  accountId: z.string().min(1),
});

export type CloudflareCredentials = z.infer<typeof cloudflareCredentialsSchema>;

export class CloudflareAdapter implements CloudflareProvider {
  constructor(private credentials: CloudflareCredentials) {}

  async testConnection() {
    try {
      const data = await this.request<{ status: string }>("/user/tokens/verify");
      if (data.status !== "active") {
        return { ok: false as const, message: "Cloudflare token is not active. Create a new API Token in Cloudflare → My Profile → API Tokens." };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Cloudflare connection failed";
      if (/invalid api token/i.test(message)) {
        return {
          ok: false as const,
          message:
            "Invalid API Token. Use an API Token from Cloudflare → My Profile → API Tokens. Account email and Global API Key will not work here.",
        };
      }
      return { ok: false as const, message };
    }

    if (!/^[a-f0-9]{32}$/i.test(this.credentials.accountId.trim())) {
      return {
        ok: false as const,
        message:
          "Account ID must be the 32-character hex ID from the Cloudflare dashboard sidebar, not an email.",
      };
    }

    try {
      await this.request(`/accounts/${this.credentials.accountId.trim()}`);
      return { ok: true as const };
    } catch (error) {
      return {
        ok: false as const,
        message:
          error instanceof Error
            ? `Token works, but this Account ID is not accessible: ${error.message}`
            : "Token works, but this Account ID is not accessible.",
      };
    }
  }

  async createZone(domain: string): Promise<CloudflareZone> {
    const existing = await this.getZone(domain);
    if (existing) return existing;

    const data = await this.request<{
      id: string;
      name: string;
      status: string;
      name_servers: string[];
    }>("/zones", {
      method: "POST",
      body: JSON.stringify({
        name: domain,
        account: { id: this.credentials.accountId },
        jump_start: false,
        type: "full",
      }),
    });

    return {
      zoneId: data.id,
      name: data.name,
      status: data.status,
      nameservers: data.name_servers ?? [],
    };
  }

  async getZone(domain: string) {
    const data = await this.request<Array<{
      id: string;
      name: string;
      status: string;
      name_servers: string[];
    }>>(`/zones?name=${encodeURIComponent(domain)}&account.id=${this.credentials.accountId}`);
    const zone = data[0];
    if (!zone) return null;
    return {
      zoneId: zone.id,
      name: zone.name,
      status: zone.status,
      nameservers: zone.name_servers ?? [],
    };
  }

  async getZoneById(zoneId: string): Promise<CloudflareZone> {
    const data = await this.request<{
      id: string;
      name: string;
      status: string;
      name_servers: string[];
    }>(`/zones/${zoneId}`);
    return {
      zoneId: data.id,
      name: data.name,
      status: data.status,
      nameservers: data.name_servers ?? [],
    };
  }

  async countZones() {
    const payload = await this.requestRaw<unknown[]>(
      `/zones?account.id=${this.credentials.accountId}&per_page=1`,
    );
    return payload.result_info?.total_count ?? (Array.isArray(payload.result) ? payload.result.length : 0);
  }

  async assertZoneCapacity() {
    const counts = await Promise.all([undefined, "active", "pending"].map(async (status) => {
      const payload = await this.requestRaw<unknown[]>(
        `/zones?account.id=${encodeURIComponent(this.credentials.accountId)}&per_page=1${status ? `&status=${status}` : ""}`,
      );
      const count = payload.result_info?.total_count;
      if (typeof count !== "number" || !Number.isInteger(count) || count < 0) {
        throw new AppError({ message: "Could not verify Cloudflare zone capacity. Try again before purchasing.", provider: "cloudflare", status: 502 });
      }
      return count;
    }));
    const [total, active, pending] = counts;
    // Cloudflare also enforces account-specific and rolling limits at creation time.
    if (total > 50 && pending > active) {
      throw cloudflareZoneLimit(`${total} zones: ${active} active, ${pending} pending.`);
    }
  }

  async listDnsRecords(zoneId: string) {
    const records: Array<{ id: string; type: string; name: string; content: string; proxied: boolean }> = [];
    for (let page = 1; ; page++) {
      const payload = await this.requestRaw<typeof records>(`/zones/${zoneId}/dns_records?per_page=100&page=${page}`);
      if (!Array.isArray(payload.result)) throw new AppError({ message: "Cloudflare returned an invalid DNS record list", provider: "cloudflare", status: 502 });
      const items = payload.result;
      records.push(...items);
      if (!items.length || (payload.result_info?.total_pages ? page >= payload.result_info.total_pages : items.length < 100)) break;
    }
    return records.map((item) => ({ ...item, proxied: Boolean(item.proxied) }));
  }

  async createDnsRecord(zoneId: string, record: { type: string; name: string; content: string; proxied?: boolean }) {
    const data = await this.request<{ id: string; type: string; name: string; content: string; proxied: boolean }>(`/zones/${zoneId}/dns_records`, {
      method: "POST", body: JSON.stringify({ ...record, proxied: record.proxied ?? false, ttl: 1 }),
    });
    return { ...data, proxied: Boolean(data.proxied) };
  }

  async upsertDnsRecord(
    zoneId: string,
    record: { type: string; name: string; content: string; proxied?: boolean },
  ) {
    const existing = await this.request<Array<{ id: string; name: string; type: string }>>(
      `/zones/${zoneId}/dns_records?type=${encodeURIComponent(record.type)}&name=${encodeURIComponent(record.name)}`,
    );
    let current = Array.isArray(existing) ? existing[0] : undefined;
    if (!current) {
      const all = await this.listDnsRecords(zoneId);
      const wanted = normalizeDnsName(record.name);
      current = all.find((item) => item.type === record.type && namesEqual(item.name, wanted));
    }
    const body = JSON.stringify({
      type: record.type,
      name: record.name,
      content: record.content,
      proxied: record.proxied ?? false,
      ttl: 1,
    });
    const data = await this.request<{
      id: string;
      type: string;
      name: string;
      content: string;
      proxied: boolean;
    }>(current ? `/zones/${zoneId}/dns_records/${current.id}` : `/zones/${zoneId}/dns_records`, {
      method: current ? "PUT" : "POST",
      body,
    });
    return {
      id: data.id,
      type: data.type,
      name: data.name,
      content: data.content,
      proxied: Boolean(data.proxied),
    };
  }

  async deleteDnsRecord(zoneId: string, recordId: string) {
    await this.request(`/zones/${zoneId}/dns_records/${recordId}`, { method: "DELETE" });
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const payload = await this.requestRaw<T>(path, init);
    return payload.result;
  }

  private async requestRaw<T>(path: string, init?: RequestInit) {
    const response = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.credentials.apiToken}`,
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
      cache: "no-store",
    });
    const text = await response.text();
    let payload: {
      success: boolean;
      result: T;
      result_info?: { total_count?: number; total_pages?: number };
      errors?: Array<{ message: string; code?: number }>;
    };
    try {
      payload = JSON.parse(text) as typeof payload;
    } catch {
      throw new AppError({
        message: "Cloudflare returned a non-JSON response. Check the API token and try again.",
        provider: "cloudflare",
        status: 502,
        retryable: true,
      });
    }
    if (!response.ok || !payload.success) {
      const raw = payload.errors?.[0]?.message || "Cloudflare request failed";
      const details = payload.errors?.map((e) => e.message).join("; ") || raw;
      if (response.status === 429 || /limit for adding zones|please activate some zones/i.test(details)) {
        throw cloudflareZoneLimit(details);
      }
      const message = /zone\.create/i.test(raw)
        ? 'Cloudflare token cannot create zones. Create a new API Token with Zone → Zone → Edit, Zone → DNS → Edit, Account → Account Settings → Read, and Zone Resources = All zones from this account. Then save it in Settings → Cloudflare and retry.'
        : raw;
      throw new AppError({
        message,
        provider: "cloudflare",
        details,
        status: 502,
        retryable: true,
      });
    }
    return payload;
  }
}

function normalizeDnsName(value: string) {
  return value.replace(/\.$/, "").toLowerCase();
}

function namesEqual(left: string, right: string) {
  return normalizeDnsName(left) === normalizeDnsName(right);
}
