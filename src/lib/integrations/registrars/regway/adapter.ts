import { AppError } from "@/lib/errors";
import dns from "node:dns/promises";
import { isIP } from "node:net";
import { domainToASCII } from "node:url";
import { chunk, sleep } from "@/lib/concurrency";
import { splitDomain } from "@/lib/utils";
import type {
  DomainAvailability,
  DomainInfo,
  DomainPrice,
  DomainRegistrar,
  Money,
  RegisterDomainRequest,
  RegisterDomainResult,
  RegistrarBalance,
  RegistrantContact,
} from "@/lib/integrations/types";
import { RegwayClient } from "./client";
import type { RegwayCredentials } from "./credentials";
import { FALLBACK_TLDS, assertValidDomain, productKeyToTld, tldToProductKey } from "./product-keys";

type CatalogPrice = {
  registration?: number;
  renewal?: number;
  transfer?: number;
  listRegistration?: number;
  promo?: boolean;
};

type PriceCache = {
  expiresAt: number;
  currency: string;
  prices: Record<string, CatalogPrice>;
};

const priceCache = new Map<string, PriceCache>();
const recentChargeCache = new Map<string, {
  expiresAt: number;
  value: Promise<DomainPrice["recentRegistration"]>;
}>();
const RECENT_CHARGE_MAX_AGE = 7 * 24 * 60 * 60 * 1000;

export class RegwayAdapter implements DomainRegistrar {
  readonly provider = "regway";
  private client: RegwayClient;
  private credentials: RegwayCredentials;
  private defaultNameservers: string[];

  constructor(credentials: RegwayCredentials, options?: { defaultNameservers?: string[] }) {
    this.credentials = credentials;
    this.client = new RegwayClient(credentials);
    this.defaultNameservers = options?.defaultNameservers?.filter(Boolean) ?? [];
  }

  async testConnection() {
    try {
      await this.client.request("/resellers/details.json", "GET", {
        "reseller-id": this.credentials.authUserId,
      });
      return { ok: true as const };
    } catch (error) {
      return {
        ok: false as const,
        message: error instanceof Error ? error.message : "Regway connection failed",
      };
    }
  }

  async getBalance(): Promise<RegistrarBalance> {
    try {
      const data = await this.client.request<Record<string, unknown>>("/billing/reseller-balance.json", "GET", {
        "reseller-id": this.credentials.authUserId,
      });
      return mapBalance(data);
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message.includes("Cloudflare") || message.includes("HTML instead of JSON")) {
        throw error;
      }
      const fallback = await this.client.request<Record<string, unknown>>("/billing/account-balance.json", "GET");
      return mapBalance(fallback);
    }
  }

  async checkDomain(domain: string): Promise<DomainAvailability> {
    const [result] = await this.checkDomains([domain]);
    return result;
  }

  async checkDomains(domains: string[]): Promise<DomainAvailability[]> {
    const unique = [...new Set(domains.map((d) => d.toLowerCase()))];
    const grouped = new Map<string, string[]>();
    for (const domain of unique) {
      const { sld, tld } = splitDomain(domain);
      if (!sld || !tld) continue;
      const list = grouped.get(tld) ?? [];
      list.push(sld);
      grouped.set(tld, list);
    }

    const results = new Map<string, DomainAvailability>();
    for (const [tld, slds] of grouped.entries()) {
      for (const group of chunk(slds, 10)) {
        await this.fillAvailability(results, tld, group);
      }
    }

    const inconclusive = unique.filter((domain) => isInconclusive(results.get(domain)));
    if (inconclusive.length) {
      await sleep(400);
      const byTld = new Map<string, string[]>();
      for (const domain of inconclusive) {
        const { sld, tld } = splitDomain(domain);
        if (!sld || !tld) continue;
        const list = byTld.get(tld) ?? [];
        list.push(sld);
        byTld.set(tld, list);
      }
      for (const [tld, slds] of byTld.entries()) {
        for (const group of chunk(slds, 5)) {
          await this.fillAvailability(results, tld, group);
        }
      }
    }

    return unique.map((domain) => {
      return (
        results.get(domain) ?? {
          domain,
          available: false,
          reason: "not_returned",
        }
      );
    });
  }

  private async fillAvailability(results: Map<string, DomainAvailability>, tld: string, slds: string[]) {
    const data = await this.client.request<Record<string, Record<string, unknown>>>(
      "/domains/available.json",
      "GET",
      {
        "domain-name": slds,
        tlds: [tld],
      },
      { absoluteUrl: this.client.checkUrl },
    );

    for (const [fqdn, info] of Object.entries(data ?? {})) {
      const domain = fqdn.includes(".") ? fqdn.toLowerCase() : `${fqdn}.${tld}`.toLowerCase();
      const status = String(info?.status ?? "").toLowerCase();
      const available = status === "available";
      results.set(domain, {
        domain,
        available,
        premium: Boolean(info?.premium || info?.costHash),
        reason: available ? undefined : status || "unavailable",
      });
    }
  }

  async getPrice(domain: string): Promise<DomainPrice> {
    const { tld } = assertValidDomain(domain);
    const catalog = await this.loadPrices();
    const prices = catalog.prices[tld] ?? catalog.prices[tldToProductKey(tld)];
    if (!prices?.registration) {
      throw new AppError({
        message: `No registration price found for .${tld}`,
        provider: "regway",
      });
    }
    const recent = !prices.promo ? await this.getRecentRegistrationCharge(tld).catch(() => undefined) : undefined;
    return {
      domain,
      premium: false,
      promo: Boolean(prices.promo),
      estimated: !prices.promo,
      recentRegistration: recent?.currency === catalog.currency ? recent : undefined,
      registration: { amount: prices.registration, currency: catalog.currency },
      listRegistration:
        prices.listRegistration && prices.listRegistration > prices.registration
          ? { amount: prices.listRegistration, currency: catalog.currency }
          : undefined,
      renewal: prices.renewal
        ? { amount: prices.renewal, currency: catalog.currency }
        : undefined,
      transfer: prices.transfer
        ? { amount: prices.transfer, currency: catalog.currency }
        : undefined,
    };
  }

  async listTlds() {
    try {
      const catalog = await this.loadPrices();
      const tlds = Object.keys(catalog.prices).sort();
      return tlds.length ? tlds : FALLBACK_TLDS;
    } catch {
      return FALLBACK_TLDS;
    }
  }

  async registerDomain(data: RegisterDomainRequest): Promise<RegisterDomainResult> {
    const submittedAt = Date.now();
    assertValidDomain(data.domain);
    const extraCustomerId = typeof data.extra?.customerId === "string" ? data.extra.customerId : undefined;
    const extraContactId = typeof data.extra?.contactId === "string" ? data.extra.contactId : undefined;
    const { customerId, contactId } =
      extraCustomerId && extraContactId
        ? { customerId: extraCustomerId, contactId: extraContactId }
        : await this.ensureContact(data.contact);
    const nameservers = await this.registrationNameservers(customerId, data.nameservers);

    const response = await this.client.request<Record<string, unknown> | string | number>(
      "/domains/register.json",
      "POST",
      {
        "domain-name": data.domain,
        years: data.years ?? 1,
        ns: nameservers,
        "customer-id": customerId,
        "reg-contact-id": contactId,
        "admin-contact-id": contactId,
        "tech-contact-id": contactId,
        "billing-contact-id": contactId,
        "invoice-option": "PayInvoice",
        "protect-privacy": false,
      },
    );

    const orderId =
      typeof response === "object"
        ? String(response.entityid ?? response.orderid ?? response.orderId ?? "")
        : String(response);
    // Registration discounts can be absent from the catalog/promo API. Read
    // our own invoice, not the customer's invoice returned by register.json.
    // A delayed invoice must never turn a completed purchase into a retry.
    const price = await this.getRegistrationCharge(data.domain, data.years ?? 1, submittedAt)
      .catch(() => undefined);
    return {
      domain: data.domain,
      price,
      orderId: orderId || undefined,
      nameservers,
      registeredAt: new Date(),
      expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      externalCustomerId: customerId,
      externalContactId: contactId,
    };
  }

  private async validateRegistrationNameservers(values: string[]) {
    const names = [...new Set(values.map(value => domainToASCII(value.trim().toLowerCase().replace(/\.$/, ""))))];
    if (names.length < 2 || names.length > 13 || names.some(name => isIP(name) !== 0 || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9-]{2,63}$/.test(name))) {
      throw new AppError({ message: "Regway: set between two and thirteen valid nameservers in Settings → Registrars.", provider: "regway", details: "invalid_nameservers" });
    }
    await Promise.all(names.map(async name => {
      try { await dns.lookup(name); }
      catch (error) {
        const code = (error as NodeJS.ErrnoException)?.code;
        throw new AppError({ message: `Regway: nameserver ${name} could not be resolved. Check nameservers in Settings → Registrars and try again.`, provider: "regway", details: code });
      }
    }));
    return names;
  }

  private async registrationNameservers(customerId: string, requested?: string[]) {
    // Explicit per-domain choices must never be silently replaced.
    if (requested?.length) return this.validateRegistrationNameservers(requested);
    if (this.defaultNameservers.length) {
      try { return await this.validateRegistrationNameservers(this.defaultNameservers); }
      catch (error) {
        if (!(error instanceof AppError) || !["ENOTFOUND", "ENODATA", "invalid_nameservers"].includes(error.details ?? "")) throw error;
      }
    }
    const defaults = await this.client.request<unknown>("/domains/customer-default-ns.json", "GET", { "customer-id": customerId });
    if (!Array.isArray(defaults) || defaults.some(value => typeof value !== "string")) {
      throw new AppError({ message: "Regway did not return default nameservers. Set valid nameservers in Settings → Registrars before registering domains.", provider: "regway" });
    }
    return this.validateRegistrationNameservers(defaults);
  }

  async getRegistrationCharge(domain: string, years = 1, notBefore?: number): Promise<Money | undefined> {
    assertValidDomain(domain);
    const data = await this.client.request<Record<string, unknown>>("/billing/my-transactions/search.json", "GET", {
      "no-of-records": 100,
      "page-no": 1,
      "transaction-type": ["invoice"],
      "transaction-description": `Registration of ${domain} for ${years} ${years === 1 ? "year" : "years"}`,
      ...(notBefore != null ? { "transaction-date-start": Math.floor(notBefore / 1000) - 5 } : {}),
    });
    return registrationCharge(data, domain, years, notBefore);
  }

  private async getRecentRegistrationCharge(tld: string): Promise<DomainPrice["recentRegistration"]> {
    const key = `${this.client.baseUrl}:${this.credentials.authUserId}:${tld}`;
    const cached = recentChargeCache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.value;
    const now = Date.now();
    const params = {
      "no-of-records": 100,
      "page-no": 1,
      "transaction-type": ["invoice"],
      "transaction-description": `.${tld} for 1 year`,
      "transaction-date-start": Math.floor((now - RECENT_CHARGE_MAX_AGE) / 1000),
    };
    const value = (async () => {
      let data = await this.client.request<Record<string, unknown>>("/billing/my-transactions/search.json", "GET", params);
      const count = Number(data.recsindb);
      if (Number.isSafeInteger(count) && count > 100) {
        data = await this.client.request<Record<string, unknown>>("/billing/my-transactions/search.json", "GET", {
          ...params, "page-no": Math.ceil(count / 100),
        });
      }
      return recentRegistrationCharge(data, tld, now);
    })().catch(() => undefined);
    // Share one billing query across a bulk search; history is reference data,
    // never a replacement for the current registration quote or its currency.
    recentChargeCache.set(key, { expiresAt: now + 5 * 60 * 1000, value });
    return value;
  }

  async setNameservers(domain: string, nameservers: string[]) {
    const info = await this.getDomain(domain);
    if (!info.orderId) {
      throw new AppError({
        message: `Could not resolve registrar order id for ${domain}`,
        provider: "regway",
        retryable: true,
      });
    }
    try {
      await this.client.request("/domains/modify-ns.json", "POST", {
        "order-id": info.orderId,
        ns: nameservers,
      });
    } catch (error) {
      const text = error instanceof Error ? `${error.message} ${(error as AppError).details ?? ""}` : String(error);
      if (/same value for new and old nameservers/i.test(text)) return;
      throw error;
    }
  }

  async getDomain(domain: string): Promise<DomainInfo> {
    const data = await this.client.request<Record<string, unknown>>("/domains/details-by-name.json", "GET", {
      "domain-name": domain,
      options: "All",
    });
    return mapDomainInfo(domain, data);
  }

  async listDomains(): Promise<DomainInfo[]> {
    const data = await this.client.request<Record<string, Record<string, unknown>>>("/domains/search.json", "GET", {
      "no-of-records": 500,
      "page-no": 1,
    });
    return Object.values(data ?? {})
      .filter((item) => item && typeof item === "object" && ("entity.domainname" in item || "domainname" in item))
      .map((item) =>
        mapDomainInfo(
          String(item["entity.domainname"] ?? item.domainname ?? ""),
          item,
        ),
      )
      .filter((item) => item.domain);
  }

  private async loadPrices(): Promise<PriceCache> {
    const cacheKey = `${this.client.baseUrl}:${this.credentials.authUserId}`;
    const cached = priceCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached;

    const data = await this.client.request<Record<string, unknown>>("/products/reseller-cost-price.json", "GET");
    const prices: PriceCache["prices"] = {};
    for (const [productKey, value] of Object.entries(data ?? {})) {
      if (!value || typeof value !== "object") continue;
      const actions = value as Record<string, Record<string, string | number>>;
      const registration = Number(actions.addnewdomain?.["1"]);
      const renewal = Number(actions.renewdomain?.["1"]);
      const transfer = Number(actions.addtransferdomain?.["1"]);
      if (!Number.isFinite(registration)) continue;
      const tld = productKeyToTld(productKey);
      prices[tld] = {
        registration,
        listRegistration: registration,
        renewal: Number.isFinite(renewal) ? renewal : undefined,
        transfer: Number.isFinite(transfer) ? transfer : undefined,
      };
    }

    try {
      const promos = await this.client.request<unknown>("/resellers/promo-details.json", "GET");
      applyRegistrationPromos(prices, promos);
    } catch {
      // Catalog prices still usable if promo lookup is blocked or empty.
    }

    const next: PriceCache = {
      expiresAt: Date.now() + 5 * 60 * 1000,
      currency: "USD",
      prices,
    };
    priceCache.set(cacheKey, next);
    return next;
  }

  private async ensureContact(contact: RegistrantContact) {
    if (this.credentials.customerId) {
      const contactId = await this.createContact(this.credentials.customerId, contact);
      return { customerId: this.credentials.customerId, contactId };
    }

    const existingId = await this.findCustomerId(contact.email);
    const customerId = existingId ?? (await this.signupCustomer(contact));
    const contactId = await this.createContact(customerId, contact);
    return { customerId, contactId };
  }

  private async findCustomerId(email: string) {
    try {
      const data = await this.client.request<Record<string, unknown>>("/customers/details.json", "GET", {
        username: email,
      });
      const id = data.customerid ?? data["customer.customerid"] ?? data.userid;
      return id != null && String(id) ? String(id) : null;
    } catch {
      return null;
    }
  }

  private async signupCustomer(contact: RegistrantContact) {
    const id = await this.client.request<string | number>("/customers/signup.json", "POST", {
      username: contact.email,
      passwd: randomCustomerPassword(),
      name: contact.name,
      company: contact.company || "NA",
      "address-line-1": contact.address,
      city: contact.city,
      state: contact.state,
      country: contact.country,
      zipcode: contact.zip,
      "phone-cc": contact.phoneCc || "1",
      phone: contact.phone.replace(/\D/g, "") || "0000000000",
      "lang-pref": "en",
    });
    return String(id);
  }

  private async createContact(customerId: string, contact: RegistrantContact) {
    const id = await this.client.request<string | number>("/contacts/add.json", "POST", {
      "customer-id": customerId,
      name: contact.name,
      company: contact.company || "NA",
      email: contact.email,
      "address-line-1": contact.address,
      city: contact.city,
      state: contact.state,
      country: contact.country,
      zipcode: contact.zip,
      "phone-cc": contact.phoneCc || "1",
      phone: contact.phone.replace(/\D/g, "") || "0000000000",
      type: "Contact",
    });
    return String(id);
  }
}

export function registrationCharge(data: Record<string, unknown>, domain: string, years: number, notBefore?: number): Money | undefined {
  const description = `Registration of ${domain} for ${years} ${years === 1 ? "year" : "years"}`.toLowerCase();
  const invoices = Object.values(data).flatMap((value) => {
    if (!value || typeof value !== "object") return [];
    const row = value as Record<string, unknown>;
    if (row.type !== "invoice" || String(row.description).trim().toLowerCase() !== description) return [];
    const amount = row.sellingamount == null || String(row.sellingamount).trim() === "" ? NaN : Number(row.sellingamount);
    const timestamp = Number(row.transactiondate);
    const currency = String(row.sellingcurrencysymbol ?? "").toUpperCase();
    if (!Number.isFinite(amount) || amount > 0 || !Number.isFinite(timestamp) || timestamp <= 0 || !/^[A-Z]{3}$/.test(currency)) return [];
    if (notBefore != null && timestamp < Math.floor(notBefore / 1000) - 5) return [];
    return [{ amount: Math.abs(amount), currency, timestamp }];
  }).sort((a, b) => b.timestamp - a.timestamp);
  const latest = invoices[0];
  if (!latest || invoices.some(row => row.timestamp === latest.timestamp && (row.amount !== latest.amount || row.currency !== latest.currency))) return undefined;
  return { amount: latest.amount, currency: latest.currency };
}

export function recentRegistrationCharge(data: Record<string, unknown>, tld: string, now = Date.now()): DomainPrice["recentRegistration"] {
  const rows = Object.values(data).flatMap(value => {
    if (!value || typeof value !== "object") return [];
    const row = value as Record<string, unknown>;
    const domain = String(row.description ?? "").match(/^Registration of ([a-z0-9.-]+) for 1 year$/i)?.[1]?.toLowerCase();
    if (!domain || splitDomain(domain).tld !== tld) return [];
    const timestamp = Number(row.transactiondate) * 1000;
    if (!Number.isFinite(timestamp) || timestamp < now - RECENT_CHARGE_MAX_AGE || timestamp > now + 5000) return [];
    const charge = registrationCharge({ invoice: row }, domain, 1, now - RECENT_CHARGE_MAX_AGE);
    return charge ? [{ ...charge, domain, chargedAt: new Date(timestamp).toISOString() }] : [];
  }).sort((a, b) => b.chargedAt.localeCompare(a.chargedAt));
  return rows[0];
}

type PromoRow = {
  productkey?: unknown;
  actiontype?: unknown;
  isactive?: unknown;
  period?: unknown;
  starttime?: unknown;
  endtime?: unknown;
  resellerprice?: unknown;
  resellerpriceone?: unknown;
};

function isInconclusive(item?: DomainAvailability) {
  if (!item) return true;
  if (item.available) return false;
  const reason = (item.reason ?? "").toLowerCase();
  return reason === "unknown" || reason === "not_returned";
}

function isTruthyFlag(value: unknown) {
  const normalized = String(value).toLowerCase();
  return value === true || value === 1 || value === "1" || normalized === "true" || normalized === "active" || normalized === "yes";
}

function unixMs(value: unknown) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n < 1e12 ? n * 1000 : n;
}

function isPromoLive(row: PromoRow, now = Date.now()) {
  if (row.isactive != null && !isTruthyFlag(row.isactive)) return false;
  const start = unixMs(row.starttime);
  const end = unixMs(row.endtime);
  if (start != null && start > now) return false;
  if (end != null && end < now) return false;
  return true;
}

function isRegistrationPromo(row: PromoRow) {
  const action = String(row.actiontype ?? "addnewdomain").toLowerCase().replace(/[^a-z]/g, "");
  return !action || action.includes("addnew") || action === "register" || action === "add";
}

function isOneYearPromo(row: PromoRow) {
  const period = String(row.period ?? "1").trim();
  return period === "" || period === "1" || period === "1.0";
}

function promoAmount(row: PromoRow) {
  const amount = Number(row.resellerprice ?? row.resellerpriceone);
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

function collectRegistrationPromos(data: unknown, into: Record<string, number> = {}) {
  if (!data) return into;
  if (Array.isArray(data)) {
    for (const item of data) collectRegistrationPromos(item, into);
    return into;
  }
  if (typeof data !== "object") return into;
  const row = data as PromoRow & Record<string, unknown>;
  if (row.productkey != null && (row.resellerprice != null || row.resellerpriceone != null)) {
    if (isPromoLive(row) && isRegistrationPromo(row) && isOneYearPromo(row)) {
      const amount = promoAmount(row);
      const tld = productKeyToTld(String(row.productkey));
      if (amount != null && tld && (into[tld] == null || amount < into[tld])) {
        into[tld] = amount;
      }
    }
    return into;
  }
  for (const value of Object.values(row)) {
    if (value && typeof value === "object") collectRegistrationPromos(value, into);
  }
  return into;
}

function applyRegistrationPromos(prices: Record<string, CatalogPrice>, data: unknown) {
  const promos = collectRegistrationPromos(data);
  for (const [tld, amount] of Object.entries(promos)) {
    const current = prices[tld] ?? {};
    const list = current.listRegistration ?? current.registration;
    if (list != null && amount >= list) continue;
    prices[tld] = {
      ...current,
      registration: amount,
      listRegistration: list,
      promo: true,
    };
  }
}

function randomCustomerPassword() {
  const letters = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const digits = "0123456789";
  const all = letters + digits;
  const chars = [
    letters[Math.floor(Math.random() * letters.length)],
    digits[Math.floor(Math.random() * digits.length)],
  ];
  while (chars.length < 12) {
    chars.push(all[Math.floor(Math.random() * all.length)]);
  }
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

function mapBalance(data: Record<string, unknown>): RegistrarBalance {
  const amount = Number(
    data.sellingcurrencybalance ?? data.balance ?? data.availablebalance ?? data.amount ?? 0,
  );
  const rawCurrency = String(data.sellingcurrencysymbol ?? data.currency ?? "USD");
  return {
    amount,
    currency: rawCurrency === "$" ? "USD" : rawCurrency || "USD",
    lockedAmount: data.sellingcurrencylockedbalance
      ? Number(data.sellingcurrencylockedbalance)
      : undefined,
  };
}

function mapDomainInfo(domain: string, data: Record<string, unknown>): DomainInfo {
  const orderId = String(
    data.orderid ?? data.entityid ?? data["orders.orderid"] ?? data["entity.orderid"] ?? "",
  );
  const endtime = data.endtime ?? data["orders.endtime"];
  const creation = data.creationtime ?? data["orders.creationtime"];
  const ns = Object.entries(data)
    .filter(([key]) => key.toLowerCase().includes("ns") && typeof data[key] === "string")
    .map(([, value]) => String(value));

  return {
    domain: String(data.domainname ?? data["entity.domainname"] ?? domain).toLowerCase(),
    orderId: orderId || undefined,
    status: String(data.currentstatus ?? data["entity.currentstatus"] ?? ""),
    expiresAt: endtime ? new Date(Number(endtime) * 1000) : undefined,
    registeredAt: creation ? new Date(Number(creation) * 1000) : undefined,
    nameservers: ns.length ? ns : undefined,
  };
}
