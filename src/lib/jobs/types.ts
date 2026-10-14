export type PurchaseItemProgress = {
  domain: string;
  status: "pending" | "queued" | "purchasing" | "purchased" | "unavailable" | "failed" | "skipped";
  step?: string;
  error?: string;
  domainId?: string;
  price?: number;
  currency?: string;
};

export type JobProgress = {
  total: number;
  completed: number;
  items: PurchaseItemProgress[];
};

export type PurchaseJobPayload = {
  registrarId: string;
  registrarName?: string;
  registrantId?: string;
  registrantName?: string;
  buyerId?: string | null;
  groupId?: string | null;
  groupName?: string;
  buyerName?: string;
  domains: string[];
  cloudflareAccountId: string;
  cloudflareName?: string;
  postPurchase?: "none" | "keitaro" | "hestia" | "both";
  keitaroServerId?: string | null;
  keitaroGroup?: string | null;
  hestiaServerId?: string | null;
  hestiaUser?: string | null;
  hestiaIp?: string | null;
  idempotencyKey: string;
  batchId: string;
};
