import { domainToASCII } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { AppError } from "@/lib/errors";
import type { DomainAvailability, DomainInfo, DomainPrice, DomainRegistrar, Money, RegisterDomainRequest, RegisterDomainResult, RegistrantContact } from "@/lib/integrations/types";
import { DynadotClient } from "./client";
import type { DynadotCredentials } from "./credentials";

type PriceRow = { currency?: string; unit?: string; registration_price?: string; renewal_price?: string; transfer_price?: string };
type SearchRow = { domain_name?: string; available?: string; premium?: string; price_list?: PriceRow[]; details_error_message?: string };
type RemoteDomain = { domain_name?: string; expiration_date?: number | string; registration_date?: number | string; status?: string };
function fail(message: string) { return new AppError({ message: `Dynadot: ${message}`, provider: "dynadot" }); }
function domainName(input: string) {
  const value = domainToASCII(input.trim().toLowerCase().replace(/\.$/, ""));
  if (value.length > 253 || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9-]{2,63}$/.test(value)) throw fail("Invalid domain name.");
  return value;
}
function money(value: unknown, currency: string): Money | undefined {
  if (typeof value !== "string" || !/^\d+(?:\.\d+)?$/.test(value.trim())) return undefined;
  const amount = Number(value);
  return Number.isFinite(amount) ? { amount, currency } : undefined;
}
function date(value?: number | string) {
  if (value === undefined || !/^\d+$/.test(String(value))) return undefined;
  const n = Number(value);
  if (n <= 0) return undefined;
  const result = new Date(n < 1e12 ? n * 1000 : n);
  return Number.isNaN(result.getTime()) ? undefined : result;
}
export function dynadotContact(contact: RegistrantContact) {
  const cc = contact.phoneCc?.replace(/\D/g, "");
  if (!cc || cc.length > 3) throw fail("Set a phone country code in the registrant profile.");
  let phone = contact.phone.replace(/\D/g, "");
  if (contact.phone.trim().startsWith("+") && phone.startsWith(cc)) phone = phone.slice(cc.length);
  const area = contact.phoneAreaCode?.replace(/\D/g, "");
  if (area && !phone.startsWith(area)) phone = area + phone;
  if (!phone || !/^[a-z]{2}$/i.test(contact.country)) throw fail("A phone number and two-letter country code are required.");
  return { name: contact.name, email: contact.email, organization: contact.company || undefined, phone_number: phone, phone_cc: cc, address1: contact.address, city: contact.city, state: contact.state, zip: contact.zip, country: contact.country.toUpperCase() };
}

export class DynadotAdapter implements DomainRegistrar {
  readonly provider = "dynadot";
  private readonly client: DynadotClient;
  private readonly currency: string;
  constructor(credentials: DynadotCredentials, private readonly options: { defaultNameservers?: string[]; currency?: string } = {}) {
    this.client = new DynadotClient(credentials);
    this.currency = (options.currency || "USD").toUpperCase();
  }
  async testConnection() {
    try { await this.getBalance(); return { ok: true as const }; }
    catch (error) { return { ok: false as const, message: error instanceof Error ? error.message : "Dynadot connection failed" }; }
  }
  async getBalance() {
    const result = await this.client.request<{ account_info?: { balance_list?: Array<{ currency: string; amount: string }> } }>("/accounts/info");
    const balances = result.account_info?.balance_list;
    if (!Array.isArray(balances)) throw fail("Account balance was not returned.");
    const balance = balances.find(row => row.currency.toUpperCase() === this.currency);
    if (!balance) return { amount: 0, currency: this.currency };
    const parsed = money(balance.amount, this.currency);
    if (!parsed) throw fail("Invalid account balance.");
    return parsed;
  }
  private price(domain: string, row: SearchRow): DomainPrice | undefined {
    const quoted = row.price_list?.find(p => p.currency?.toUpperCase() === this.currency && /^(?:\(price\/)?1\s*years?\)?$/i.test(p.unit?.trim() || ""));
    const registration = money(quoted?.registration_price, this.currency);
    if (!registration) return undefined;
    return { domain, registration, renewal: money(quoted?.renewal_price, this.currency), transfer: money(quoted?.transfer_price, this.currency), premium: row.premium?.toLowerCase() === "yes" ? true : row.premium?.toLowerCase() === "no" ? false : undefined };
  }
  private availability(domain: string, row?: SearchRow): DomainAvailability {
    return { domain, available: row?.available?.toLowerCase() === "yes" && !row.details_error_message, reason: row?.details_error_message || (row?.available?.toLowerCase() === "no" ? "Registered" : row?.available?.toLowerCase() !== "yes" ? "Dynadot did not confirm availability" : undefined), premium: row?.premium?.toLowerCase() === "yes", price: row ? this.price(domain, row) : undefined };
  }
  async checkDomain(input: string) {
    const domain = domainName(input);
    const row = await this.client.request<SearchRow>(`/domains/${encodeURIComponent(domain)}/search`, "GET", { show_price: true, currency: this.currency });
    if (row.domain_name?.toLowerCase() !== domain) throw fail("Search returned a different domain.");
    return this.availability(domain, row);
  }
  async checkDomains(inputs: string[]) {
    const domains = [...new Set(inputs.map(domainName))];
    const results = new Map<string, DomainAvailability>();
    // Five domains per request works on the Regular pricing tier too.
    for (let start = 0; start < domains.length; start += 5) {
      const batch = domains.slice(start, start + 5);
      // Dynadot restricts the optional timeout parameter to canary accounts.
      const response = await this.client.request<{ domain_result_list?: SearchRow[] }>("/domains/bulk_search", "GET", { domain_name_list: batch, show_price: true, currency: this.currency });
      if (!Array.isArray(response.domain_result_list)) throw fail("Invalid bulk search response.");
      for (const row of response.domain_result_list) if (row.domain_name && batch.includes(row.domain_name.toLowerCase())) results.set(row.domain_name.toLowerCase(), this.availability(row.domain_name.toLowerCase(), row));
    }
    return domains.map(domain => results.get(domain) ?? this.availability(domain));
  }
  async getPrice(domain: string) {
    const checked = await this.checkDomain(domain);
    if (!checked.price) throw fail(`One-year registration price in ${this.currency} was not returned for ${checked.domain}.`);
    return checked.price;
  }
  async suggestDomains(keyword: string, tld: string, amount: number) {
    const seed = domainName(`${keyword}.${tld.replace(/^\./, "")}`);
    const zone = seed.slice(seed.indexOf(".") + 1);
    const response = await this.client.request<{ domain_list?: Array<{ domain_name?: string }> }>(
      `/domains/${encodeURIComponent(seed)}/suggestion_search`, "GET",
      { tlds: zone, max_count: Math.min(100, Math.max(1, amount)), show_price: false },
    );
    if (!Array.isArray(response.domain_list)) throw fail("Invalid suggestions response.");
    const names = new Set<string>();
    for (const row of response.domain_list) {
      if (!row.domain_name) continue;
      try {
        const name = domainName(row.domain_name);
        // Keep only single labels in the requested zone, including multi-part TLDs.
        if (name.endsWith(`.${zone}`) && !name.slice(0, -zone.length - 1).includes(".")) names.add(name);
      } catch { /* Ignore malformed provider suggestions. */ }
    }
    return [...names];
  }
  async listTlds() {
    const names = new Set<string>();
    for (let page = 1; page <= 1000; page++) {
      const response = await this.client.request<{ page_size?: number; tld_price_list?: Array<{ tld: string }> }>("/domains/get_tld_price", "GET", { currency: this.currency, page, page_size: 100, sort: "name_asc", show_multi_year: false });
      const rows = response.tld_price_list;
      if (!Array.isArray(rows)) throw fail("Invalid TLD list response.");
      const before = names.size;
      for (const row of rows) names.add(domainName(`example.${row.tld.replace(/^\./, "")}`).slice(8));
      const pageSize = response.page_size && response.page_size > 0 ? response.page_size : 100;
      if (rows.length < pageSize) return [...names].sort();
      if (names.size === before) throw fail("TLD pagination did not advance.");
    }
    throw fail("TLD list exceeded pagination limit.");
  }
  async registerDomain(request: RegisterDomainRequest): Promise<RegisterDomainResult> {
    const domain = domainName(request.domain);
    const years = request.years ?? 1;
    if (!Number.isInteger(years) || years < 1 || years > 10) throw fail("Registration period must be between 1 and 10 years.");
    const contact = dynadotContact(request.contact);
    const nameservers = this.nameservers(request.nameservers ?? this.options.defaultNameservers ?? []);
    const quote = await this.getPrice(domain);
    const result = await this.client.request<{ domain_name?: string; expiration_date?: string }>(`/domains/${encodeURIComponent(domain)}/register`, "POST", {
      domain: { duration: years, privacy: "full", registrant_contact: contact, admin_contact: contact, tech_contact: contact, billing_contact: contact, ...(nameservers.length ? { name_server_list: nameservers } : {}) },
      currency: this.currency, register_premium: quote.premium === true,
    });
    if (result.domain_name?.toLowerCase() !== domain) throw fail("Registration response did not confirm the requested domain. Check Dynadot before retrying.");
    return { domain, registrationStatus: "purchased", expiresAt: date(result.expiration_date), nameservers: nameservers.length ? nameservers : undefined };
  }
  private nameservers(inputs: string[]) {
    const names = [...new Set(inputs.map(domainName))];
    if (names.length === 1 || names.length > 13) throw fail("Supply between two and thirteen nameservers.");
    return names;
  }
  async setNameservers(input: string, inputs: string[]) {
    const domain = domainName(input), nameservers = this.nameservers(inputs);
    if (!nameservers.length) throw fail("At least two nameservers are required.");
    const waits = [2000, 5000, 10000];
    for (let attempt = 0; ; attempt++) {
      try {
        await this.client.request(`/domains/${encodeURIComponent(domain)}/nameservers`, "PUT", { nameserver_list: nameservers });
        return;
      } catch (error) {
        // Newly registered domains can take a few seconds to reach the nameserver API.
        // Retry only this idempotent update, never the registration/payment request.
        const initializing = error instanceof AppError && error.provider === "dynadot" &&
          (error.message.toLowerCase().includes(`can not find the ${domain} in the account`) ||
            error.message.toLowerCase().includes("domain initialization is still in progress"));
        if (!initializing || attempt >= waits.length) throw error;
        await delay(waits[attempt]);
      }
    }
  }
  private info(row: RemoteDomain): DomainInfo {
    if (!row?.domain_name) throw fail("Domain information is missing its name.");
    return { domain: domainName(row.domain_name), status: row.status, registeredAt: date(row.registration_date), expiresAt: date(row.expiration_date) };
  }
  async getDomain(input: string) {
    const domain = domainName(input);
    const response = await this.client.request<{ domain_info: RemoteDomain }>(`/domains/${encodeURIComponent(domain)}`);
    const info = this.info(response.domain_info);
    if (info.domain !== domain) throw fail("Domain information returned a different domain.");
    const ns = await this.client.request<{ nameserver_list?: Array<{ server_name: string }> }>(`/domains/${encodeURIComponent(domain)}/nameservers`);
    return { ...info, nameservers: ns.nameserver_list?.map(row => row.server_name) ?? [] };
  }
  async listDomains() {
    const domains: DomainInfo[] = [];
    for (let page = 1; page <= 1000; page++) {
      const response = await this.client.request<{ domain_info_list?: RemoteDomain[]; pagination_result?: { has_next_page?: string } }>("/domains", "GET", { page, page_size: 100, sort: "name_asc", status: "active" });
      if (!Array.isArray(response.domain_info_list)) throw fail("Invalid domain list response.");
      domains.push(...response.domain_info_list.map(row => this.info(row)));
      if (response.pagination_result?.has_next_page?.toLowerCase() === "no" || (!response.pagination_result?.has_next_page && response.domain_info_list.length < 100)) return domains;
      if (!response.domain_info_list.length) throw fail("Domain pagination did not advance.");
    }
    throw fail("Domain list exceeded pagination limit.");
  }
}
