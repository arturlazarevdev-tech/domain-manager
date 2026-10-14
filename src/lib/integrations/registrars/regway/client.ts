import { AppError } from "@/lib/errors";
import type { RegwayCredentials } from "./credentials";

type HttpMethod = "GET" | "POST";

export class RegwayClient {
  constructor(private credentials: RegwayCredentials) {}

  get baseUrl() {
    if (this.credentials.baseUrl) {
      return this.credentials.baseUrl.replace(/\/$/, "");
    }
    return this.credentials.sandbox ? "https://test.httpapi.com/api" : "https://httpapi.com/api";
  }

  get checkUrl() {
    if (this.credentials.baseUrl) {
      return `${this.baseUrl}/domains/available.json`;
    }
    return this.credentials.sandbox
      ? "https://test.httpapi.com/api/domains/available.json"
      : "https://domaincheck.httpapi.com/api/domains/available.json";
  }

  async request<T>(
    path: string,
    method: HttpMethod,
    params: Record<string, string | number | boolean | Array<string | number>> = {},
    options?: { absoluteUrl?: string },
  ): Promise<T> {
    const body = new URLSearchParams();
    body.set("auth-userid", this.credentials.authUserId.trim());
    body.set("api-key", this.credentials.apiKey.trim());

    for (const [key, value] of Object.entries(params)) {
      if (Array.isArray(value)) {
        for (const item of value) body.append(key, String(item));
      } else if (value !== undefined && value !== null) {
        body.set(key, String(value));
      }
    }

    const url = options?.absoluteUrl ?? `${this.baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
    const requestUrl = method === "GET" ? `${url}?${body.toString()}` : url;
    const response = await fetch(requestUrl, {
      method,
      headers: {
        Accept: "application/json,text/plain,*/*",
        "User-Agent": "DomainManager/1.0 (Regway adapter)",
        ...(method === "POST" ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
      },
      body: method === "POST" ? body : undefined,
      cache: "no-store",
    });

    const text = await response.text();
    let data: unknown = text;
    try {
      data = JSON.parse(text);
    } catch {
      // keep raw text
    }

    if (!response.ok || isCloudflareChallenge(text)) {
      const ip = await publicIp();
      throw new AppError({
        message: describeRegwayFailure(response.status, text, ip),
        provider: "regway",
        details: describeRegwayFailure(response.status, text, ip),
        status: 502,
        retryable: false,
      });
    }

    if (isRegwayError(data)) {
      throw new AppError({
        message: extractRegwayError(data) || "Regway returned an error",
        provider: "regway",
        details: extractRegwayError(data),
        status: 400,
      });
    }

    return data as T;
  }
}

function isCloudflareChallenge(text: string) {
  return (
    text.includes("Attention Required! | Cloudflare") ||
    text.includes("Sorry, you have been blocked") ||
    text.includes("cf-error-details") ||
    text.includes("Request forbidden by administrative rules")
  );
}

export function describeRegwayFailure(status: number, text: string, ip?: string | null): string {
  if (isCloudflareChallenge(text)) {
    const ipNote = ip ? ` This computer's public IP is ${ip}.` : "";
    return `Cloudflare blocked this computer from reaching httpapi.com.${ipNote} This is not an API key problem. Try another network or VPN, then whitelist that IP in Regway → Settings → API.`;
  }
  if (text.trim().startsWith("<")) {
    return `Regway returned HTML instead of JSON (HTTP ${status}). The API host may be blocked from this IP.`;
  }
  return extractRegwayError(text) || `Regway request failed (HTTP ${status})`;
}

async function publicIp() {
  try {
    const response = await fetch("https://api.ipify.org?format=json", { cache: "no-store" });
    const data = (await response.json()) as { ip?: string };
    return data.ip ?? null;
  } catch {
    return null;
  }
}

function isRegwayError(data: unknown) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return false;
  const record = data as Record<string, unknown>;
  const status = String(record.status ?? "").toUpperCase();
  return status === "ERROR";
}

export function extractRegwayError(data: unknown): string {
  if (!data) return "Unknown Regway error";
  if (typeof data === "string") {
    const trimmed = data.trim();
    if (trimmed.includes("<html")) {
      return describeRegwayFailure(0, trimmed);
    }
    try {
      return extractRegwayError(JSON.parse(trimmed));
    } catch {
      return humanizeRegwayMessage(trimmed) || trimmed;
    }
  }
  if (typeof data === "object") {
    const record = data as Record<string, unknown>;
    const raw =
      record.message ??
      record.Message ??
      record.error ??
      record.msg ??
      record.errorReason;
    const humanized = humanizeRegwayMessage(raw);
    if (humanized) return humanized;
    if (raw != null) return String(raw);
    try {
      return JSON.stringify(record);
    } catch {
      return "Unknown Regway error";
    }
  }
  return "Unknown Regway error";
}

function humanizeRegwayMessage(raw: unknown): string | null {
  if (raw == null || raw === "") return null;
  if (typeof raw === "object") {
    const parts = Object.entries(raw as Record<string, unknown>)
      .map(([key, value]) => `${key}: ${String(value)}`)
      .filter(Boolean);
    return parts.length ? parts.join("; ") : null;
  }
  const text = String(raw).trim();
  if (!text) return null;
  const fields = [...text.matchAll(/(\w+)=([^{}]+?)(?=,\s*\w+=|}$)/g)];
  if (text.startsWith("{") && text.endsWith("}") && fields.length) {
    return fields
      .map(([, key, value]) => {
        if (key === "passwd") {
          return "Registrar rejected the generated customer password. Retry the purchase.";
        }
        return `${key}: ${value.trim()}`;
      })
      .join("; ");
  }
  return text;
}
