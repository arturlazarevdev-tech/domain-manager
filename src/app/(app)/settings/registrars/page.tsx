"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/app-shell";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card, Input } from "@/components/ui/primitives";
import { Dialog, Field, Select } from "@/components/ui/dialog";
import { api } from "@/lib/api/client";

type Registrar = {
  id: string; name: string; provider: string; currency: string; enabled: boolean;
  credentials: string; connectionStatus: string; lastError?: string | null;
  defaultNameservers: string[]; sandbox: boolean;
};
const empty = {
  name: "Regway", provider: "regway", currency: "USD", authUserId: "", apiKey: "", apiSecret: "", username: "", password: "",
  sandbox: false, enabled: true, defaultNameservers: "ns1.onlyfordns.net, ns2.onlyfordns.net",
};

export default function RegistrarsSettingsPage() {
  const queryClient = useQueryClient();
  const { data } = useQuery({ queryKey: ["registrars"], queryFn: () => api<{ registrars: Registrar[] }>("/api/registrars") });
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(empty);
  const isOpenprovider = form.provider === "openprovider";
  const isDynadot = form.provider === "dynadot";

  async function save() {
    setSaving(true);
    try {
      await api(editingId ? `/api/registrars/${editingId}` : "/api/registrars", {
        method: editingId ? "PATCH" : "POST",
        body: JSON.stringify({
          name: form.name, provider: form.provider, currency: form.currency, enabled: form.enabled,
          defaultNameservers: form.defaultNameservers.split(",").map((s) => s.trim()).filter(Boolean),
          credentials: isOpenprovider
            ? { username: form.username, password: form.password, sandbox: form.sandbox }
            : isDynadot ? { apiKey: form.apiKey, apiSecret: form.apiSecret, sandbox: form.sandbox }
            : { authUserId: form.authUserId, apiKey: form.apiKey, sandbox: form.sandbox },
        }),
      });
      toast.success("Registrar saved");
      setOpen(false);
      for (const key of ["registrars", "balance", "dashboard"]) queryClient.invalidateQueries({ queryKey: [key] });
    } catch (error) { toast.error(error instanceof Error ? error.message : "Save failed"); }
    finally { setSaving(false); }
  }
  function edit(item: Registrar) {
    setEditingId(item.id);
    setForm({ ...empty, name: item.name, provider: item.provider, currency: item.currency, enabled: item.enabled, sandbox: item.sandbox, defaultNameservers: item.defaultNameservers.join(", ") });
    setOpen(true);
  }

  return <div>
    <PageHeader title="Registrars" actions={<Button onClick={() => { setEditingId(null); setForm(empty); setOpen(true); }}>Add</Button>} />
    <div className="grid gap-3">
      {(data?.registrars ?? []).map((item) => <Card key={item.id} className="flex items-center justify-between gap-3">
        <div>
          <div className="font-medium">{item.name}</div>
          <div className="text-sm text-muted-foreground">{item.provider} · {item.credentials}{item.sandbox ? " · Sandbox" : ""}</div>
          {item.lastError && <div className="mt-2 max-w-xl text-sm text-destructive">{item.lastError}</div>}
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge value={item.connectionStatus} />
          <Button variant="outline" onClick={() => edit(item)}>Edit</Button>
          <Button variant="outline" onClick={async () => {
            try {
              const result = await api<{ ok: boolean; message?: string }>(`/api/registrars/${item.id}/test`, { method: "POST" });
              toast[result.ok ? "success" : "error"](result.ok ? "Connected" : result.message || "Connection failed");
              queryClient.invalidateQueries({ queryKey: ["registrars"] });
            } catch (error) { toast.error(error instanceof Error ? error.message : "Test failed"); }
          }}>Test connection</Button>
        </div>
      </Card>)}
    </div>
    <Dialog open={open} onClose={() => setOpen(false)} title={editingId ? "Edit registrar" : "Add registrar"}>
      <div className="grid gap-3">
        <Field label="Name"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
        <Field label="Provider">
          <Select disabled={Boolean(editingId)} value={form.provider} onChange={(e) => {
            const provider = e.target.value;
            setForm({ ...empty, provider, name: provider === "openprovider" ? "Openprovider" : provider === "dynadot" ? "Dynadot" : "Regway", defaultNameservers: provider === "regway" ? empty.defaultNameservers : "" });
          }}>
            <option value="regway">Regway</option><option value="openprovider">Openprovider</option><option value="dynadot">Dynadot</option>
          </Select>
        </Field>
        {isOpenprovider ? <>
          <Field label="Username"><Input autoComplete="off" value={form.username} placeholder={editingId ? "Leave blank to keep current username" : "Openprovider username"} onChange={(e) => setForm({ ...form, username: e.target.value })} /></Field>
          <Field label="Password"><Input type="password" autoComplete="new-password" value={form.password} placeholder={editingId ? "Leave blank to keep current password" : "Openprovider password"} onChange={(e) => setForm({ ...form, password: e.target.value })} /></Field>
          <p className="text-xs text-muted-foreground">Enable API access in Openprovider: Account overview → Contact persons → API. Sandbox uses a separate sandbox account.</p>
        </> : isDynadot ? <>
          <Field label="API key"><Input type="password" autoComplete="new-password" value={form.apiKey} placeholder={editingId ? "Leave blank to keep current key" : "Dynadot API key"} onChange={(e) => setForm({ ...form, apiKey: e.target.value })} /></Field>
          <Field label="API secret"><Input type="password" autoComplete="new-password" value={form.apiSecret} placeholder={editingId ? "Leave blank to keep current secret" : "Dynadot API secret"} onChange={(e) => setForm({ ...form, apiSecret: e.target.value })} /></Field>
          <p className="text-xs text-muted-foreground">Enable RESTful API access in Dynadot → Tools → API and allow this server’s IP. Use the API key and matching secret. Sandbox uses separate credentials.</p>
        </> : <>
          <Field label="Reseller ID"><Input value={form.authUserId} placeholder={editingId ? "Leave blank to keep current ID" : ""} onChange={(e) => setForm({ ...form, authUserId: e.target.value })} /></Field>
          <Field label="API key"><Input type="password" value={form.apiKey} placeholder={editingId ? "Leave blank to keep current key" : ""} onChange={(e) => setForm({ ...form, apiKey: e.target.value })} /></Field>
          <p className="text-xs text-muted-foreground">Allow this server’s IP in Regway → Settings → API.</p>
        </>}
        <Field label="Default nameservers"><Input value={form.defaultNameservers} placeholder={isOpenprovider || isDynadot ? "Optional: uses registrar defaults until Cloudflare is assigned" : "ns1.example.com, ns2.example.com"} onChange={(e) => setForm({ ...form, defaultNameservers: e.target.value })} /></Field>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.sandbox} onChange={(e) => setForm({ ...form, sandbox: e.target.checked })} />Sandbox</label>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
        <Button onClick={save} disabled={saving || !form.name.trim() || (!editingId && (isOpenprovider ? !form.username.trim() || !form.password : isDynadot ? !form.apiKey.trim() || !form.apiSecret.trim() : !form.authUserId.trim() || !form.apiKey.trim()))}>{saving ? "Saving..." : "Save"}</Button>
      </div>
    </Dialog>
  </div>;
}
