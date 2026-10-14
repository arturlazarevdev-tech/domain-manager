import { z } from "zod";
import { AppError } from "@/lib/errors";
import type { KeitaroDomain, KeitaroProvider } from "@/lib/integrations/types";

export const keitaroCredentialsSchema = z.object({
  apiKey: z.string().min(1),
});

export type KeitaroCredentials = z.infer<typeof keitaroCredentialsSchema>;

export class KeitaroAdapter implements KeitaroProvider {
  constructor(
    private baseUrl: string,
    private credentials: KeitaroCredentials,
  ) {}

  async testConnection() {
    try {
      await this.request("/domains?limit=1");
      return { ok: true as const };
    } catch (error) {
      return {
        ok: false as const,
        message: error instanceof Error ? error.message : "Keitaro connection failed",
      };
    }
  }

  async addDomain(domain: string, options?: { group?: string | null }): Promise<KeitaroDomain> {
    const existing = (await this.listDomains()).find((item) => item.name.toLowerCase() === domain.toLowerCase() && item.status !== "deleted");
    if (existing) return options?.group !== undefined ? this.updateDomain(existing.id, options) : existing;
    const group = options?.group?.trim();
    const groupId = group ? await this.findOrCreateGroup(group) : undefined;
    const data = await this.request<KeitaroApiDomain>("/domains", {
      method: "POST",
      body: JSON.stringify({
        name: domain,
        ...(groupId ? { group_id: groupId } : {}),
        ...(group ? { notes: group } : {}),
      }),
    });
    return mapKeitaroDomain(data);
  }

  async updateDomain(id: string, options: { group?: string | null }): Promise<KeitaroDomain> {
    const group = options.group?.trim();
    const groupId = group ? await this.findOrCreateGroup(group) : 0;
    const data = await this.request<KeitaroApiDomain>(`/domains/${encodeURIComponent(id)}`, {
      method: "PUT", body: JSON.stringify({ group_id: String(groupId) }),
    });
    return mapKeitaroDomain(data);
  }

  private async findOrCreateGroup(name: string): Promise<number> {
    const payload = await this.request<Array<{ id: number; name: string; type?: string }> | { items: Array<{ id: number; name: string; type?: string }> }>("/groups?type=domains");
    const items = Array.isArray(payload) ? payload : payload.items;
    const found = items.find((item) => item.name.toLowerCase() === name.toLowerCase() && (!item.type || item.type === "domains"));
    if (found) return Number(found.id);
    const created = await this.request<{ id: number }>("/groups", { method: "POST", body: JSON.stringify({ name, type: "domains" }) });
    if (!created.id) throw new AppError({ message: "Keitaro did not return the domain group ID", provider: "keitaro" });
    return Number(created.id);
  }

  async listDomains(): Promise<KeitaroDomain[]> {
    const data = await this.request<KeitaroApiDomain[] | { items?: KeitaroApiDomain[] }>("/domains");
    const items = Array.isArray(data) ? data : (data.items ?? []);
    return items.map(mapKeitaroDomain);
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const url = `${this.baseUrl.replace(/\/$/, "")}/admin_api/v1${path}`;
    const response = await fetch(url, {
      ...init,
      headers: {
        "Api-Key": this.credentials.apiKey,
        Authorization: `Bearer ${this.credentials.apiKey}`,
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
      cache: "no-store",
    });
    const text = await response.text();
    let payload: unknown = text;
    try {
      payload = JSON.parse(text);
    } catch {
      // keep text
    }
    if (!response.ok) {
      const message =
        typeof payload === "object" && payload && "error" in payload
          ? String((payload as { error: unknown }).error)
          : text || `Keitaro HTTP ${response.status}`;
      throw new AppError({
        message: "Keitaro request failed",
        provider: "keitaro",
        details: message,
        status: 502,
        retryable: response.status >= 500,
      });
    }
    return payload as T;
  }
}

type KeitaroApiDomain = {
  id: number | string;
  name: string;
  status?: string;
  state?: string;
  group?: string | null;
};

function mapKeitaroDomain(data: KeitaroApiDomain): KeitaroDomain {
  return {
    id: String(data.id),
    name: data.name,
    status: data.state === "deleted" ? "deleted" : data.status ?? data.state,
    group: data.group,
  };
}
