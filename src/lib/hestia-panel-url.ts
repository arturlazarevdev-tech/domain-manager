import { Resolver } from "node:dns/promises";
import { isIP } from "node:net";

export async function hestiaPanelUrl(server: { url: string; ipAddress?: string | null }) {
  let url: URL;
  try { url = new URL(server.url); }
  catch { return { panelUrl: null, panelUsesIp: false }; }
  if (!["https:", "http:"].includes(url.protocol)) return { panelUrl: null, panelUsesIp: false };
  // Browser navigation never carries API credentials, paths or query strings.
  url.username = "";
  url.password = "";
  url.pathname = "/";
  url.search = "";
  url.hash = "";
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (!isIP(hostname) && server.ipAddress && isIP(server.ipAddress)) {
    // Public DNS deliberately ignores application-only /etc/hosts mappings.
    const resolver = new Resolver({ timeout: 1000, tries: 1 });
    try { await Promise.any([resolver.resolve4(hostname), resolver.resolve6(hostname)]); }
    catch { url.hostname = isIP(server.ipAddress) === 6 ? `[${server.ipAddress}]` : server.ipAddress; }
    finally { resolver.cancel(); }
  }
  return { panelUrl: url.href, panelUsesIp: Boolean(isIP(url.hostname.replace(/^\[|\]$/g, ""))) };
}
