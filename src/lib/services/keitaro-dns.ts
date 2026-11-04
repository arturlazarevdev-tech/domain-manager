import { isIPv4 } from "node:net";
import type { CloudflareAdapter } from "@/lib/integrations/cloudflare/adapter";

export function validateServerIp(ip: string) {
  if (!isIPv4(ip)) throw new Error("Enter a valid IPv4 address");
  return ip;
}

// Keitaro itself does not need domain recreation when its origin IP changes.
export async function updateKeitaroDns(adapter: Pick<CloudflareAdapter, "listDnsRecords" | "updateDnsRecordIp">, zoneId: string, domain: string, ip: string) {
  validateServerIp(ip);
  const normalize = (name: string) => name.toLowerCase().replace(/\.$/, "");
  const root = normalize(domain);
  const records = await adapter.listDnsRecords(zoneId);
  const apex = records.filter(r => [root, "@"].includes(normalize(r.name)));
  const www = records.filter(r => [`www.${root}`, "www"].includes(normalize(r.name)));
  if (!apex.some(r => r.type === "A")) throw new Error("Root A record is missing; configure this domain's DNS first");
  if ([...apex, ...www].some(r => r.type === "AAAA")) throw new Error("Root/www has an IPv6 record; resolve IPv6 routing before changing IPv4");
  if (www.some(r => r.type === "CNAME" && normalize(r.content) !== root)) throw new Error("www points to another hostname; review its DNS before updating");
  for (const record of [...apex, ...www]) {
    if (record.type === "A" && record.content !== ip) await adapter.updateDnsRecordIp(zoneId, record.id, ip);
  }
  const updated = await adapter.listDnsRecords(zoneId);
  const relevant = updated.filter(r => [root, "@", `www.${root}`, "www"].includes(normalize(r.name)) && r.type === "A");
  if (!relevant.some(r => [root, "@"].includes(normalize(r.name))) || relevant.some(r => r.content !== ip)) throw new Error("DNS verification failed; retry the update");
  return updated;
}
