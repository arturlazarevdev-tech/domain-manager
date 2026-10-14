import { domainToASCII } from "node:url";
import { AppError } from "@/lib/errors";
import { chunk } from "@/lib/concurrency";
import { splitDomain } from "@/lib/utils";
import type { DomainAvailability, DomainInfo, DomainPrice, DomainRegistrar, RegisterDomainRequest, RegisterDomainResult, RegistrarBalance, RegistrantContact, Money } from "@/lib/integrations/types";
import { OpenproviderClient } from "./client";
import type { OpenproviderCredentials } from "./credentials";

type PriceGroup = { reseller?: { price: number | string; currency: string }; product?: { price: number | string; currency: string } };
type PriceResponse = { price?: PriceGroup; tier_price?: PriceGroup; is_premium?: boolean; is_promotion?: boolean };
type RemoteDomain = {
  id: number; domain?: { name: string; extension: string }; status?: string;
  active_date?: string; activation_date?: string; creation_date?: string; expiration_date?: string; renewal_date?: string;
  name_servers?: Array<{ name: string }>;
};

function fail(message: string) { return new AppError({ message: `Openprovider: ${message}`, provider: "openprovider" }); }
function domainParts(input: string) {
  const domain = domainToASCII(input.trim().toLowerCase().replace(/\.$/, ""));
  const { sld: name, tld: extension } = splitDomain(domain);
  if (!domain || domain.length > 253 || !extension || domain.split(".").some((label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) {
    throw fail(`Invalid domain name: ${input}`);
  }
  return { domain, name, extension };
}
function money(group?: PriceGroup): Money | undefined {
  const value = group?.reseller;
  if (!value || value.price === "" || value.price === null || !Number.isFinite(Number(value.price)) || Number(value.price) < 0 || !value.currency) return undefined;
  return { amount: Number(value.price), currency: value.currency };
}
function date(value?: string): Date | undefined {
  if (!value || value.startsWith("0000-")) return undefined;
  const parsed = new Date(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value) ? value.replace(" ", "T") + "Z" : value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}
function mapDomain(data: RemoteDomain, fallback?: string): DomainInfo {
  return {
    domain: data.domain ? `${data.domain.name}.${data.domain.extension}` : fallback ?? "",
    orderId: String(data.id), status: data.status,
    registeredAt: date(data.active_date ?? data.activation_date ?? data.creation_date),
    expiresAt: date(data.renewal_date ?? data.expiration_date), nameservers: data.name_servers?.map((ns) => ns.name),
  };
}

export function openproviderContact(contact: RegistrantContact) {
  const names = contact.name.trim().split(/\s+/);
  if (names.length < 2) throw fail("Registrant Name must contain first and last name.");
  const address = contact.address.trim();
  const leading = address.match(/^(\d+[\w/-]*)\s+(.+)$/);
  const trailing = address.match(/^(.+?)\s+(\d+[\w/-]*)$/);
  const street = trailing?.[1] ?? leading?.[2];
  const number = trailing?.[2] ?? leading?.[1];
  if (!street || !number) throw fail("Registrant Address must include a street and house number, e.g. Main Street 10.");
  const cc = (contact.phoneCc ?? "").replace(/\D/g, "");
  const area = (contact.phoneAreaCode ?? "").replace(/\D/g, "");
  let local = contact.phone.replace(/\D/g, "");
  if (contact.phone.trim().startsWith("+") && cc && local.startsWith(cc)) {
    local = local.slice(cc.length);
    if (area && local.startsWith(area)) local = local.slice(area.length);
  }
  if (!cc || !area || local.length < 3) throw fail("Fill Phone country code, Phone area code and Phone in Registrant Profiles. Phone contains the subscriber number.");
  return {
    name: { first_name: names[0], last_name: names.slice(1).join(" "), full_name: contact.name.trim() },
    email: contact.email, ...(contact.company ? { company_name: contact.company } : {}),
    address: { street, number, city: contact.city, zipcode: contact.zip, country: contact.country.toUpperCase(), state: contact.state },
    phone: { country_code: `+${cc}`, area_code: area, subscriber_number: local },
  };
}

export class OpenProviderAdapter implements DomainRegistrar {
  readonly provider = "openprovider";
  private readonly client: OpenproviderClient;
  private readonly defaultNameservers: string[];
  constructor(credentials: OpenproviderCredentials, options?: { defaultNameservers?: string[] }) {
    this.client = new OpenproviderClient(credentials);
    this.defaultNameservers = options?.defaultNameservers?.filter(Boolean) ?? [];
  }
  async testConnection() {
    try { await this.getBalance(); return { ok: true as const }; }
    catch (error) { return { ok: false as const, message: error instanceof Error ? error.message : "Openprovider connection failed" }; }
  }
  async getBalance(): Promise<RegistrarBalance> {
    const data = await this.client.request<{ balance: number; reserved_balance?: number; settings?: { currency?: string } }>("/resellers", "GET", { with_settings: true });
    if ((data.balance === null || data.balance === undefined) || !Number.isFinite(Number(data.balance)) || !data.settings?.currency) throw fail("Balance or account currency was not returned.");
    return { amount: Number(data.balance), currency: data.settings.currency, lockedAmount: data.reserved_balance === undefined ? undefined : Number(data.reserved_balance) };
  }
  async checkDomain(domain: string): Promise<DomainAvailability> { return (await this.checkDomains([domain]))[0]; }
  async checkDomains(domains: string[]): Promise<DomainAvailability[]> {
    const unique = [...new Set(domains.map((value) => domainParts(value).domain))];
    const results = new Map<string, DomainAvailability>();
    for (const batch of chunk(unique, 50)) {
      const data = await this.client.request<{ results: Array<{ domain: string; status: string; reason?: string; is_premium?: boolean; price?: PriceGroup }> }>("/domains/check", "POST", {
        domains: batch.map((value) => { const { name, extension } = domainParts(value); return { name, extension }; }), with_price: true,
      });
      if (!Array.isArray(data.results)) throw fail("Domain check returned no results.");
      for (const row of data.results) {
        const domain = row.domain.toLowerCase();
        const registration = money(row.price);
        results.set(domain, { domain, available: row.status === "free", premium: row.is_premium, reason: row.reason || (row.status === "free" ? undefined : row.status), price: registration ? { domain, registration, premium: row.is_premium } : undefined });
      }
    }
    return unique.map((domain) => results.get(domain) ?? { domain, available: false, reason: "Openprovider did not return availability" });
  }
  async getPrice(input: string): Promise<DomainPrice> {
    const { domain, name, extension } = domainParts(input);
    const result = await this.client.request<PriceResponse>("/domains/prices", "GET", { "domain.name": name, "domain.extension": extension, operation: "create", period: 1 });
    const registration = money(result.price);
    if (!registration) throw fail(`Registration price in account currency was not returned for ${domain}.`);
    const list = money(result.tier_price);
    return { domain, registration, premium: result.is_premium, promo: result.is_promotion, listRegistration: result.is_promotion && list && list.currency === registration.currency && list.amount > registration.amount ? list : undefined };
  }
  async listTlds(): Promise<string[]> {
    const results = await this.list<{ name: string }>("/tlds", { only_names: true, is_active: true });
    return [...new Set(results.map((row) => row.name.replace(/^\./, "")))].sort();
  }
  async registerDomain(data: RegisterDomainRequest): Promise<RegisterDomainResult> {
    const { domain, name, extension } = domainParts(data.domain);
    const years = data.years ?? 1;
    if (!Number.isInteger(years) || years < 1 || years > 10) throw fail("Registration period must be between 1 and 10 years.");
    const handle = typeof data.extra?.contactId === "string" && data.extra.contactId
      ? data.extra.contactId : (await this.client.request<{ handle: string }>("/customers", "POST", openproviderContact(data.contact))).handle;
    if (!handle) throw fail("Customer creation returned no contact handle.");
    const nameservers = data.nameservers?.length ? data.nameservers : this.defaultNameservers;
    const response = await this.client.request<RemoteDomain>("/domains", "POST", {
      domain: { name, extension }, period: years, owner_handle: handle, admin_handle: handle, tech_handle: handle, billing_handle: handle,
      autorenew: "off", is_dnssec_enabled: false,
      additional_data: { consent_for_publishing: "0" },
      ...(nameservers.length >= 2 ? { name_servers: nameservers.map((name) => ({ name })) } : { ns_group: "dns-openprovider" }),
    });
    if (!response.id) throw fail("Registration returned no domain ID. Check Openprovider before retrying.");
    const info = mapDomain(response, domain);
    return { ...info, registrationStatus: response.status === "ACT" ? "purchased" : "pending", nameservers: nameservers.length >= 2 ? nameservers : undefined, externalCustomerId: handle, externalContactId: handle };
  }
  async getDomain(input: string): Promise<DomainInfo> {
    const { domain } = domainParts(input);
    const data = await this.client.request<{ results: RemoteDomain[] }>("/domains", "GET", { full_name: domain, limit: 10 });
    const found = data.results?.find((row) => row.domain && `${row.domain.name}.${row.domain.extension}`.toLowerCase() === domain);
    if (!found) throw fail(`Domain ${domain} was not found in this account.`);
    return mapDomain(await this.client.request<RemoteDomain>(`/domains/${found.id}`), domain);
  }
  async setNameservers(domain: string, nameservers: string[]): Promise<void> {
    const clean = [...new Set(nameservers.map((value) => value.trim().toLowerCase()).filter(Boolean))];
    if (clean.length < 2) throw fail("At least two nameservers are required.");
    const info = await this.getDomain(domain);
    await this.client.request(`/domains/${encodeURIComponent(info.orderId!)}`, "PUT", { name_servers: clean.map((name) => ({ name })) });
  }
  async listDomains(): Promise<DomainInfo[]> { return (await this.list<RemoteDomain>("/domains")).map((row) => mapDomain(row)); }
  private async list<T>(path: string, query: Record<string, unknown> = {}): Promise<T[]> {
    const rows: T[] = [];
    const limit = 100;
    for (let offset = 0; ; offset += limit) {
      const data = await this.client.request<{ results: T[]; total?: number }>(path, "GET", { ...query, limit, offset });
      if (!Array.isArray(data.results)) throw fail(`Invalid list response from ${path}.`);
      rows.push(...data.results);
      if (!data.results.length || (data.total !== undefined ? rows.length >= data.total : data.results.length < limit)) return rows;
    }
  }
}
