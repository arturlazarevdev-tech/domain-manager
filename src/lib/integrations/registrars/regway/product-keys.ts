import { AppError } from "@/lib/errors";
import { splitDomain } from "@/lib/utils";

const TLD_TO_PRODUCT_KEY: Record<string, string> = {
  com: "dotcom",
  net: "dotnet",
  org: "dotorg",
  info: "dotinfo",
  biz: "dotbiz",
  name: "dotname",
  us: "dotus",
  in: "dotin",
  eu: "doteu",
  uk: "dotuk",
  "co.uk": "dotuk",
  "org.uk": "dotorguk",
  "me.uk": "dotmeuk",
  de: "dotde",
  es: "dotes",
  fr: "dotfr",
  it: "dotit",
  nl: "dotnl",
  be: "dotbe",
  pl: "dotpl",
  ru: "dotru",
  ca: "dotca",
  au: "dotau",
  co: "dotco",
  io: "dotio",
  me: "dotme",
  tv: "dottv",
  cc: "dotcc",
  ws: "dotws",
  bz: "dotbz",
  mn: "dotmn",
  mobi: "dotmobi",
  asia: "dotasia",
  xxx: "dotxxx",
  tel: "dottel",
  pro: "dotpro",
  club: "dotclub",
  xyz: "dotxyz",
  online: "dotonline",
  site: "dotsite",
  shop: "dotshop",
  store: "dotstore",
  tech: "dottech",
  app: "dotapp",
  dev: "dotdev",
  ai: "dotai",
  top: "dottop",
  icu: "doticu",
  live: "dotlive",
  news: "dotnews",
  blog: "dotblog",
  cloud: "dotcloud",
  space: "dotspace",
  website: "dotwebsite",
};

export const FALLBACK_TLDS = [
  "com",
  "net",
  "org",
  "io",
  "co",
  "de",
  "fr",
  "it",
  "es",
  "pl",
  "uk",
  "us",
  "info",
  "biz",
  "xyz",
  "online",
  "site",
  "shop",
  "app",
  "dev",
  "ai",
  "me",
  "tv",
  "cc",
  "pro",
  "club",
  "top",
  "store",
  "tech",
];

export function tldToProductKey(tld: string) {
  const key = tld.toLowerCase().replace(/^\./, "");
  return TLD_TO_PRODUCT_KEY[key] ?? `dot${key.replace(/\./g, "")}`;
}

export function productKeyToTld(productKey: string) {
  const found = Object.entries(TLD_TO_PRODUCT_KEY).find(([, key]) => key === productKey);
  if (found) return found[0];
  if (productKey.startsWith("dot")) return productKey.slice(3);
  return productKey;
}

export function assertValidDomain(domain: string) {
  const { sld, tld } = splitDomain(domain);
  if (!sld || !tld || !/^[a-z0-9-]+$/i.test(sld)) {
    throw new AppError({ message: `Invalid domain name: ${domain}` });
  }
  return { sld, tld };
}
