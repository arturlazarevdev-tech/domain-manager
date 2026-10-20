export type Money = {
  amount: number;
  currency: string;
};

export type RegistrarBalance = {
  amount: number;
  currency: string;
  lockedAmount?: number;
};

export type DomainAvailability = {
  domain: string;
  available: boolean;
  premium?: boolean;
  reason?: string;
  price?: DomainPrice;
};

export type DomainPrice = {
  domain: string;
  registration: Money;
  renewal?: Money;
  transfer?: Money;
  listRegistration?: Money;
  premium?: boolean;
  promo?: boolean;
  estimated?: boolean;
  recentRegistration?: Money & { domain: string; chargedAt: string };
};

export type RegistrantContact = {
  name: string;
  company?: string;
  email: string;
  phone: string;
  phoneCc?: string;
  phoneAreaCode?: string;
  country: string;
  state: string;
  city: string;
  address: string;
  zip: string;
};

export type RegisterDomainRequest = {
  domain: string;
  years?: number;
  nameservers?: string[];
  contact: RegistrantContact;
  extra?: Record<string, unknown>;
};

export type RegisterDomainResult = {
  domain: string;
  registrationStatus?: "purchased" | "pending";
  orderId?: string;
  registeredAt?: Date;
  expiresAt?: Date;
  nameservers?: string[];
  price?: Money;
  externalCustomerId?: string;
  externalContactId?: string;
};

export type DomainInfo = {
  domain: string;
  orderId?: string;
  status?: string;
  registeredAt?: Date;
  expiresAt?: Date;
  nameservers?: string[];
};

export interface DomainRegistrar {
  readonly provider: string;
  getBalance(): Promise<RegistrarBalance>;
  checkDomain(domain: string): Promise<DomainAvailability>;
  checkDomains(domains: string[]): Promise<DomainAvailability[]>;
  getPrice(domain: string): Promise<DomainPrice>;
  listTlds(): Promise<string[]>;
  suggestDomains?(keyword: string, tld: string, amount: number): Promise<string[]>;
  registerDomain(data: RegisterDomainRequest): Promise<RegisterDomainResult>;
  setNameservers(domain: string, nameservers: string[]): Promise<void>;
  getDomain(domain: string): Promise<DomainInfo>;
  listDomains(): Promise<DomainInfo[]>;
  testConnection(): Promise<{ ok: true } | { ok: false; message: string }>;
}

export type CloudflareZone = {
  zoneId: string;
  name: string;
  status: string;
  nameservers: string[];
};

export type CloudflareDnsRecord = {
  id: string;
  type: string;
  name: string;
  content: string;
  proxied: boolean;
};

export interface CloudflareProvider {
  testConnection(): Promise<{ ok: true } | { ok: false; message: string }>;
  createZone(domain: string): Promise<CloudflareZone>;
  getZone(domain: string): Promise<CloudflareZone | null>;
  getZoneById(zoneId: string): Promise<CloudflareZone>;
  countZones(): Promise<number>;
  listDnsRecords(zoneId: string): Promise<CloudflareDnsRecord[]>;
  upsertDnsRecord(
    zoneId: string,
    record: { type: string; name: string; content: string; proxied?: boolean },
  ): Promise<CloudflareDnsRecord>;
  createDnsRecord(zoneId: string, record: { type: string; name: string; content: string; proxied?: boolean }): Promise<CloudflareDnsRecord>;
  deleteDnsRecord(zoneId: string, recordId: string): Promise<void>;
}

export type KeitaroDomain = {
  id: string;
  name: string;
  status?: string;
  group?: string | null;
};

export interface KeitaroProvider {
  testConnection(): Promise<{ ok: true } | { ok: false; message: string }>;
  addDomain(domain: string, options?: { group?: string | null }): Promise<KeitaroDomain>;
  listDomains(): Promise<KeitaroDomain[]>;
  updateDomain(id: string, options: { group?: string | null }): Promise<KeitaroDomain>;
}

export type HestiaDomain = {
  name: string;
  user: string;
  ip?: string;
};

export interface HestiaProvider {
  testConnection(): Promise<{ ok: true } | { ok: false; message: string }>;
  listUsers(): Promise<string[]>;
  listIps(user: string): Promise<string[]>;
  addWebDomain(user: string, domain: string, ip?: string | null): Promise<HestiaDomain>;
}
