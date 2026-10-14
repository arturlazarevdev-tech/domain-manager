import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatMoney(amount: number | string, currency = "USD") {
  const value = typeof amount === "string" ? Number(amount) : amount;
  if (!Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
  }).format(value);
}

export function formatDate(value?: Date | string | null) {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

export function formatDateTime(value?: Date | string | null) {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function normalizeDomain(input: string) {
  return input.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
}

export function parseDomainList(input: string) {
  const seen = new Set<string>();
  const domains: string[] = [];
  for (const raw of input.split(/[\s,;]+/)) {
    const domain = normalizeDomain(raw);
    if (!domain || !domain.includes(".")) continue;
    if (seen.has(domain)) continue;
    seen.add(domain);
    domains.push(domain);
  }
  return domains;
}

export function splitDomain(domain: string) {
  const normalized = normalizeDomain(domain);
  const idx = normalized.indexOf(".");
  if (idx <= 0) {
    return { sld: normalized, tld: "" };
  }
  return {
    sld: normalized.slice(0, idx),
    tld: normalized.slice(idx + 1),
  };
}

export function maskSecret(last4?: string | null) {
  if (!last4) return "••••••••";
  return `••••••••••••${last4}`;
}

export function last4(value: string) {
  return value.slice(-4);
}

export function buyerLabel(buyer: { name: string; stageName?: string | null }) {
  return buyer.name;
}

export function providerLabel(provider: string) {
  if (provider === "regway") return "Regway";
  if (provider === "openprovider") return "Openprovider";
  return provider;
}

export function registrantLabel(profile: { name: string; label?: string | null }) {
  const label = profile.label?.trim();
  return label ? `${profile.name} (${label})` : profile.name;
}
