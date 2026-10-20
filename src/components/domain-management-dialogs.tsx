"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Dialog, Field, Select } from "@/components/ui/dialog";
import { Input, Textarea } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api/client";
import { useCart } from "@/lib/cart";
import { purchaseDay } from "@/lib/domain-report";

export type ManagedDomain = {
  id: string; domain: string; purchasePrice: number; currency: string; purchasedAt?: string | null;
  registrar: { id: string; name: string };
  buyer: { id: string; name: string } | null;
  buyerGroup: { id: string; name: string } | null;
  cloudflare: { account: { id: string; name: string }; zoneId?: string | null } | null;
  keitaro?: { server: { id: string }; groupName?: string | null; serverIp?: string | null } | null;
  dns?: { ip: string | null };
  hestia?: { server: { id: string }; webUser?: string | null; ip?: string | null } | null;
};
type Server = { id: string; name: string; ipAddress?: string | null; username?: string };
function useRefreshDomains() {
  const client = useQueryClient();
  return () => { for (const key of ["domains", "domain", "dashboard", "buyers", "buyer-groups", "cloudflare", "keitaro", "hestia"]) client.invalidateQueries({ queryKey: [key] }); };
}

// Mounted only while open so every edit starts with the latest domain values.
export function DomainManagementDialog({ domain, onClose }: { domain?: ManagedDomain; onClose: () => void }) {
  const refresh = useRefreshDomains();
  const cartRegistrar = useCart((state) => state.registrarId);
  const registrars = useQuery({ queryKey: ["registrars"], queryFn: () => api<{ registrars: Array<{ id: string; name: string }> }>("/api/registrars") });
  const buyers = useQuery({ queryKey: ["buyers"], queryFn: () => api<{ buyers: Array<{ id: string; name: string }> }>("/api/buyers") });
  const groups = useQuery({ queryKey: ["buyer-groups"], queryFn: () => api<{ groups: Array<{ id: string; name: string }> }>("/api/buyer-groups") });
  const cf = useQuery({ queryKey: ["cloudflare"], queryFn: () => api<{ accounts: Array<{ id: string; name: string; domainCount: number }> }>("/api/cloudflare") });
  const kt = useQuery({ queryKey: ["keitaro"], queryFn: () => api<{ servers: Server[] }>("/api/keitaro") });
  const hs = useQuery({ queryKey: ["hestia"], queryFn: () => api<{ servers: Server[] }>("/api/hestia") });
  const [form, setForm] = useState({
    domain: domain?.domain ?? "", registrarId: domain?.registrar.id ?? cartRegistrar ?? "",
    recipient: domain?.buyer ? `buyer:${domain.buyer.id}` : domain?.buyerGroup ? `group:${domain.buyerGroup.id}` : "",
    purchasePrice: String(domain?.purchasePrice ?? 0), currency: domain?.currency ?? "USD", date: purchaseDay(domain?.purchasedAt) ?? "",
    cloudflareAccountId: domain?.cloudflare?.account.id ?? "", mode: domain ? "configure" : "existing",
    serverType: domain?.keitaro ? "keitaro" : domain?.hestia ? "hestia" : "none", serverId: domain?.keitaro?.server.id ?? domain?.hestia?.server.id ?? "",
    serverIp: domain?.keitaro?.serverIp ?? domain?.hestia?.ip ?? domain?.dns?.ip ?? "", keitaroGroup: domain?.keitaro?.groupName ?? domain?.buyer?.name ?? "",
    hestiaUser: domain?.hestia?.webUser ?? "",
    allowIndexing: false,
  });
  const [saving, setSaving] = useState(false);
  const servers = form.serverType === "keitaro" ? kt.data?.servers ?? [] : hs.data?.servers ?? [];
  async function save() {
    setSaving(true);
    try {
      const [type, recipientId] = form.recipient.split(":");
      const purchasedAt = domain?.purchasedAt && form.date === purchaseDay(domain.purchasedAt) ? domain.purchasedAt : new Date(`${form.date}T00:00:00`).toISOString();
      const result = await api<{ warnings: string[] }>(domain ? `/api/domains/${domain.id}/manage` : "/api/domains", {
        method: domain ? "PATCH" : "POST", body: JSON.stringify({
          domain: form.domain, registrarId: form.registrarId, buyerId: type === "buyer" ? recipientId : null, groupId: type === "group" ? recipientId : null,
          purchasePrice: Number(form.purchasePrice), currency: form.currency.toUpperCase(), purchasedAt,
          cloudflareAccountId: form.cloudflareAccountId || null, mode: form.mode, serverType: form.serverType, serverId: form.serverId || null,
          serverIp: form.serverIp, keitaroGroup: form.keitaroGroup, hestiaUser: form.hestiaUser, allowIndexing: form.allowIndexing,
        }),
      });
      refresh();
      if (result.warnings.length) toast.error(`Domain saved. Configuration needs attention: ${result.warnings.join("; ")}`, { duration: 10000 });
      else toast.success(domain ? "Domain updated" : "Domain added");
      onClose();
    } catch (error) { toast.error(error instanceof Error ? error.message : "Save failed"); }
    finally { setSaving(false); }
  }
  return <Dialog open onClose={() => { if (!saving) onClose(); }} title={domain ? `Update ${domain.domain}` : "Add existing domain"} className="max-w-2xl">
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Domain"><Input disabled={Boolean(domain)} placeholder="example.com" value={form.domain} onChange={(e) => setForm({ ...form, domain: e.target.value })} /></Field>
      <Field label="Registrar"><Select value={form.registrarId} onChange={(e) => setForm({ ...form, registrarId: e.target.value })}><option value="">Select registrar</option>{(registrars.data?.registrars ?? []).map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</Select></Field>
      <Field label="Buyer / Group needs"><Select value={form.recipient} onChange={(e) => {
        const value = e.target.value;
        const [type, id] = value.split(":");
        const name = type === "buyer" ? buyers.data?.buyers.find((row) => row.id === id)?.name : groups.data?.groups.find((row) => row.id === id)?.name;
        setForm({ ...form, recipient: value, keitaroGroup: name ?? "" });
      }}><option value="">Unassigned</option><optgroup label="Buyers">{(buyers.data?.buyers ?? []).map((row) => <option key={row.id} value={`buyer:${row.id}`}>{row.name}</option>)}</optgroup><optgroup label="Group needs">{(groups.data?.groups ?? []).map((row) => <option key={row.id} value={`group:${row.id}`}>{row.name}</option>)}</optgroup></Select></Field>
      <Field label="Purchased date"><Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></Field>
      <Field label="Purchase price"><Input type="number" min="0" step="0.01" value={form.purchasePrice} onChange={(e) => setForm({ ...form, purchasePrice: e.target.value })} /></Field>
      <Field label="Currency"><Input maxLength={3} value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value.toUpperCase() })} /></Field>
      <Field label="Cloudflare account"><Select value={form.cloudflareAccountId} onChange={(e) => setForm({ ...form, cloudflareAccountId: e.target.value })}><option value="">None</option>{(cf.data?.accounts ?? []).map((row) => <option key={row.id} value={row.id}>{row.name} · {row.domainCount} domains</option>)}</Select></Field>
      <Field label="Action"><Select value={form.mode} onChange={(e) => setForm({ ...form, mode: e.target.value })}><option value="existing">Save existing settings</option><option value="configure">Configure Cloudflare and server</option></Select></Field>
      <Field label="Server type"><Select value={form.serverType} onChange={(e) => setForm({ ...form, serverType: e.target.value, serverId: "", serverIp: "" })}><option value="none">No server / DNS only</option><option value="keitaro">Keitaro</option><option value="hestia">Hestia</option></Select></Field>
      {form.serverType !== "none" && <Field label="Server"><Select value={form.serverId} onChange={(e) => { const server = servers.find((row) => row.id === e.target.value); setForm({ ...form, serverId: e.target.value, serverIp: server?.ipAddress ?? "", hestiaUser: server?.username ?? "" }); }}><option value="">Select server</option>{servers.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</Select></Field>}
      <Field label="Server IP"><Input placeholder="Uses the selected server IP when blank" value={form.serverIp} onChange={(e) => setForm({ ...form, serverIp: e.target.value })} /></Field>
      {form.serverType === "keitaro" && <Field label="Keitaro domain group"><Input value={form.keitaroGroup} onChange={(e) => setForm({ ...form, keitaroGroup: e.target.value })} placeholder="Buyer name or custom group" /></Field>}
      {form.serverType === "keitaro" && form.mode === "configure" && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.allowIndexing} onChange={(e) => setForm({ ...form, allowIndexing: e.target.checked })} />Allow search engine indexing</label>}
      {form.serverType === "hestia" && <Field label="Hestia user"><Input value={form.hestiaUser} onChange={(e) => setForm({ ...form, hestiaUser: e.target.value })} placeholder="Uses the server's configured user" /></Field>}
    </div>
    <p className="mt-3 text-xs text-muted-foreground">{form.mode === "existing" ? "Records the selected settings and reads existing Cloudflare/Keitaro data. It does not change DNS, nameservers or the server." : "Updates DNS to the selected IP and adds or updates the domain on the destination server. A new Cloudflare account also updates nameservers at the registrar."}</p>
    <div className="mt-4 flex justify-end gap-2"><Button variant="outline" disabled={saving} onClick={onClose}>Cancel</Button><Button disabled={saving || !form.domain.trim() || !form.registrarId || !form.date || !form.currency || (form.serverType !== "none" && !form.serverId)} onClick={save}>{saving ? "Saving..." : domain ? "Update" : "Add domain"}</Button></div>
  </Dialog>;
}

export function TxtRecordDialog({ domain, onClose }: { domain: { id: string; domain: string }; onClose: () => void }) {
  const refresh = useRefreshDomains();
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);
  async function save() {
    setSaving(true);
    try {
      await api(`/api/domains/${domain.id}/txt`, { method: "POST", body: JSON.stringify({ name: "@", content }) });
      refresh(); toast.success("TXT record added"); onClose();
    } catch (error) { toast.error(error instanceof Error ? error.message : "Could not add TXT record"); }
    finally { setSaving(false); }
  }
  return <Dialog open onClose={() => { if (!saving) onClose(); }} title={`Add TXT · ${domain.domain}`}>
    <Field label="TXT value"><Textarea value={content} onChange={(e) => setContent(e.target.value)} placeholder="Verification token or other TXT content" /></Field>
    <p className="mt-3 text-xs text-muted-foreground">Adds a TXT record for {domain.domain} in Cloudflare.</p>
    <div className="mt-4 flex justify-end gap-2"><Button variant="outline" disabled={saving} onClick={onClose}>Cancel</Button><Button disabled={saving || !content} onClick={save}>{saving ? "Adding..." : "Add TXT"}</Button></div>
  </Dialog>;
}
