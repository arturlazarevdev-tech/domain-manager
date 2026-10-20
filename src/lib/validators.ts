import { z } from "zod";

export const registrarUpsertSchema = z.object({
  name: z.string().min(1),
  provider: z.enum(["regway", "openprovider", "dynadot"]),
  currency: z.string().min(1).default("USD"),
  enabled: z.boolean().optional().default(true),
  defaultNameservers: z.array(z.string()).optional(),
  credentials: z
    .object({
      authUserId: z.string().optional(),
      apiKey: z.string().optional(),
      apiSecret: z.string().optional(),
      sandbox: z.boolean().optional(),
      customerId: z.string().optional(),
      username: z.string().optional(),
      password: z.string().optional(),
    })
    .optional(),
});

export const buyerGroupSchema = z.object({ name: z.string().trim().min(1).max(64) });

export const assignmentSchema = z.object({
  buyerId: z.string().min(1).nullable().optional(),
  groupId: z.string().min(1).nullable().optional(),
}).refine((value) => Boolean(value.buyerId) !== Boolean(value.groupId), {
  message: "Select either a buyer or a group",
});

export const buyerSchema = z.object({
  name: z.string().trim().min(1).max(64),
  isDefault: z.boolean().optional(),
  groupId: z.string().min(1).nullable().optional(),
});

export const registrantSchema = z.object({
  phoneAreaCode: z.string().trim().regex(/^\d*$/, "Phone area code must contain digits only").max(8).optional(),
  label: z.string().trim().max(100).optional(),
  name: z.string().min(1),
  company: z.string().optional(),
  email: z.string().email(),
  phone: z.string().min(3),
  phoneCc: z.string().optional(),
  country: z.string().min(2),
  state: z.string().min(1),
  city: z.string().min(1),
  address: z.string().min(1),
  zip: z.string().min(1),
  registrarId: z.string().min(1),
  isDefault: z.boolean().optional(),
});

export const cloudflareSchema = z.object({
  name: z.string().min(1),
  accountId: z
    .string()
    .trim()
    .regex(
      /^[a-f0-9]{32}$/i,
      "Account ID is 32 hex characters from the Cloudflare dashboard (right sidebar), not an email.",
    ),
  apiToken: z.string().optional(),
  enabled: z.boolean().optional(),
});

export const keitaroSchema = z.object({
  name: z.string().min(1),
  url: z.string().url(),
  ipAddress: z.string().optional(),
  apiKey: z.string().optional(),
  enabled: z.boolean().optional(),
});

export const hestiaSchema = z.object({
  name: z.string().min(1),
  url: z.string().url(),
  username: z.string().min(1),
  ipAddress: z.string().optional(),
  accessKey: z.string().optional(),
  secretKey: z.string().optional(),
  enabled: z.boolean().optional(),
});

export const settingsSchema = z.object({
  defaultRegistrarId: z.string().nullable().optional(),
  defaultBuyerId: z.string().nullable().optional(),
  defaultCloudflareId: z.string().nullable().optional(),
  defaultRegistrantId: z.string().nullable().optional(),
  defaultPostPurchase: z.enum(["none", "keitaro", "hestia"]).optional(),
  defaultKeitaroServerId: z.string().nullable().optional(),
  defaultHestiaServerId: z.string().nullable().optional(),
  defaultHestiaUser: z.string().nullable().optional(),
  wwwRecordMode: z.enum(["a", "cname"]).optional(),
  dnsProxied: z.boolean().optional(),
});

export const checkSchema = z.object({
  domain: z.string().min(3),
  registrarId: z.string().optional(),
});

export const checkBulkSchema = z.object({
  domains: z.array(z.string()).min(1).max(200),
  registrarId: z.string().optional(),
});

export const userCreateSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(1).optional(),
  role: z.enum(["admin", "tech"]).optional().default("tech"),
});

export const userUpdateSchema = z.object({
  email: z.string().email().optional(),
  password: z.string().min(8).optional(),
  name: z.string().min(1).nullable().optional(),
  role: z.enum(["admin", "tech"]).optional(),
});

export const purchaseSchema = z.object({
  domains: z.array(z.string()).min(1),
  registrarId: z.string().min(1),
  registrantId: z.string().min(1),
  buyerId: z.string().min(1).nullable().optional(),
  groupId: z.string().min(1).nullable().optional(),
  cloudflareAccountId: z.string().min(1),
  postPurchase: z.enum(["none", "keitaro", "hestia", "both"]).optional(),
  keitaroServerId: z.string().nullable().optional(),
  keitaroGroup: z.string().nullable().optional(),
  hestiaServerId: z.string().nullable().optional(),
  hestiaUser: z.string().nullable().optional(),
  hestiaIp: z.string().nullable().optional(),
}).refine((value) => Boolean(value.buyerId) !== Boolean(value.groupId), {
  message: "Select either a buyer or a group",
});

export const domainManagementSchema = z.object({
  registrarId: z.string().min(1),
  buyerId: z.string().min(1).nullable().optional(),
  groupId: z.string().min(1).nullable().optional(),
  purchasePrice: z.number().finite().min(0).max(9999999999.99),
  currency: z.string().trim().regex(/^[A-Z]{3}$/),
  purchasedAt: z.iso.datetime(),
  cloudflareAccountId: z.string().min(1).nullable().optional(),
  serverType: z.enum(["none", "keitaro", "hestia"]),
  serverId: z.string().min(1).nullable().optional(),
  serverIp: z.string().trim().optional(),
  keitaroGroup: z.string().trim().max(128).optional(),
  allowIndexing: z.boolean().default(false),
  hestiaUser: z.string().trim().max(64).optional(),
  mode: z.enum(["existing", "configure"]),
}).refine((body) => !(body.buyerId && body.groupId), { message: "Select either a buyer or a group" })
  .refine((body) => body.serverType === "none" || Boolean(body.serverId), { message: "Select a server" });

export const manualDomainSchema = domainManagementSchema.safeExtend({ domain: z.string().trim().min(3).max(253) });
export const txtRecordSchema = z.object({
  name: z.string().trim().min(1).max(253),
  content: z.string().min(1).max(4096),
});
