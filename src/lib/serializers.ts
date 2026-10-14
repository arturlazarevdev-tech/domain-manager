import { decryptJson } from "@/lib/crypto";
import { last4, maskSecret } from "@/lib/utils";

function omitSecrets<T extends object>(value: T) {
  const copy = { ...value } as T & { credentialsEncrypted?: unknown };
  delete copy.credentialsEncrypted;
  return copy;
}

export function publicRegistrar(account: {
  id: string;
  name: string;
  provider: string;
  currency: string;
  enabled: boolean;
  defaultNameservers: string[];
  connectionStatus: string;
  lastError: string | null;
  lastTestedAt: Date | null;
  credentialsLast4: string | null;
  credentialsEncrypted: string;
  createdAt: Date;
}) {
  return {
    ...omitSecrets(account),
    sandbox: Boolean(decryptJson<{ sandbox?: boolean }>(account.credentialsEncrypted).sandbox),
    credentials: maskSecret(account.credentialsLast4),
  };
}

export function publicCloudflare(account: {
  id: string;
  name: string;
  accountId: string;
  enabled: boolean;
  connectionStatus: string;
  lastError: string | null;
  lastTestedAt: Date | null;
  credentialsLast4: string | null;
}) {
  return {
    ...omitSecrets(account),
    credentials: maskSecret(account.credentialsLast4),
    accountShort: `${account.accountId.slice(0, 4)}...${account.accountId.slice(-4)}`,
  };
}

export function publicServer(server: {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  connectionStatus: string;
  lastError: string | null;
  lastTestedAt: Date | null;
  credentialsLast4: string | null;
  username?: string;
  ipAddress?: string | null;
}) {
  return {
    ...omitSecrets(server),
    credentials: maskSecret(server.credentialsLast4),
  };
}

export function serializeDomain(domain: {
  id: string;
  domain: string;
  tld: string;
  purchasePrice: { toString(): string } | number;
  currency: string;
  registeredAt: Date | null;
  expiresAt: Date | null;
  status: string;
  nameservers: string[];
  errorMessage: string | null;
  createdAt: Date;
  registrar: { id: string; name: string; provider: string };
  buyerGroup?: { id: string; name: string } | null;
  buyer: {
    id: string;
    name: string;
    stageName: string | null;
    keitaroGroup: string | null;
    group?: { id: string; name: string } | null;
  } | null;
  cloudflare: {
    status: string;
    nameservers: string[];
    zoneId: string | null;
    errorMessage: string | null;
    account: { id: string; name: string };
  } | null;
  keitaro: {
    status: string;
    groupName: string | null;
    serverIp: string | null;
    errorMessage: string | null;
    server: { id: string; name: string; ipAddress?: string | null };
  } | null;
  hestia: {
    status: string;
    ip: string | null;
    webUser: string;
    errorMessage: string | null;
    server: { id: string; name: string; ipAddress?: string | null };
  } | null;
  dnsRecords?: Array<{
    id: string;
    type: string;
    name: string;
    content: string;
    proxied: boolean;
  }>;
}) {
  const dnsIp =
    domain.dnsRecords?.find((record) => record.type === "A" && (record.name === "@" || record.name === domain.domain))
      ?.content ??
    domain.keitaro?.serverIp ??
    domain.hestia?.ip ??
    null;
  const server = domain.keitaro
    ? { type: "keitaro" as const, name: domain.keitaro.server.name, id: domain.keitaro.server.id, status: domain.keitaro.status }
    : domain.hestia
      ? { type: "hestia" as const, name: domain.hestia.server.name, id: domain.hestia.server.id, status: domain.hestia.status }
      : null;
  return {
    id: domain.id,
    domain: domain.domain,
    tld: domain.tld,
    purchasePrice: Number(domain.purchasePrice),
    currency: domain.currency,
    registeredAt: domain.registeredAt,
    expiresAt: domain.expiresAt,
    purchasedAt: domain.registeredAt ?? domain.createdAt,
    status: domain.status,
    nameservers: domain.nameservers,
    errorMessage: domain.errorMessage,
    registrar: domain.registrar,
    buyerGroup: domain.buyer ? domain.buyer.group ?? null : domain.buyerGroup ?? null,
    buyer: domain.buyer
      ? {
          id: domain.buyer.id,
          name: domain.buyer.name,
          stageName: domain.buyer.stageName,
          keitaroGroup: domain.buyer.keitaroGroup || domain.buyer.stageName,
        }
      : null,
    cloudflare: domain.cloudflare
      ? {
          status: domain.cloudflare.status,
          nameservers: domain.cloudflare.nameservers,
          zoneId: domain.cloudflare.zoneId,
          account: domain.cloudflare.account,
          errorMessage: domain.cloudflare.errorMessage,
        }
      : null,
    dns: {
      ip: dnsIp,
      records: domain.dnsRecords ?? [],
    },
    keitaro: domain.keitaro
      ? {
          status: domain.keitaro.status,
          groupName: domain.keitaro.groupName,
          serverIp: domain.keitaro.serverIp,
          server: domain.keitaro.server,
          errorMessage: domain.keitaro.errorMessage,
        }
      : null,
    hestia: domain.hestia
      ? {
          status: domain.hestia.status,
          ip: domain.hestia.ip,
          webUser: domain.hestia.webUser,
          server: domain.hestia.server,
          errorMessage: domain.hestia.errorMessage,
        }
      : null,
    server,
    group: domain.keitaro?.groupName || domain.buyer?.keitaroGroup || domain.buyer?.stageName || null,
  };
}

export { last4 };
