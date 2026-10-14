"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/app-shell";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card, Input } from "@/components/ui/primitives";
import { Dialog, Field } from "@/components/ui/dialog";
import { api } from "@/lib/api/client";

type Account = {
  id: string;
  name: string;
  accountId: string;
  accountShort?: string;
  credentials: string;
  connectionStatus: string;
  lastError?: string | null;
  zoneCount?: number;
  domainCount?: number;
};

const empty = { name: "CF Main", accountId: "", apiToken: "" };

export default function CloudflareSettingsPage() {
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey: ["cloudflare"],
    queryFn: () => api<{ accounts: Account[] }>("/api/cloudflare"),
  });
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(empty);
  const [saving, setSaving] = useState(false);

  function closeModal() {
    setOpen(false);
    setEditingId(null);
    setForm(empty);
  }

  async function save() {
    if (!editingId && !form.apiToken.trim()) {
      toast.error("API token is required");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim() || "CF Main",
        accountId: form.accountId.trim(),
        ...(form.apiToken.trim() ? { apiToken: form.apiToken.trim() } : {}),
      };
      const result = editingId
        ? await api<{ test?: { ok: boolean; message?: string } }>(`/api/cloudflare/${editingId}`, {
            method: "PATCH",
            body: JSON.stringify(payload),
          })
        : await api<{ test?: { ok: boolean; message?: string } }>("/api/cloudflare", {
            method: "POST",
            body: JSON.stringify(payload),
          });
      await queryClient.invalidateQueries({ queryKey: ["cloudflare"] });
      if (result.test?.ok) {
        toast.success("Token saved. Connected");
        closeModal();
      } else {
        toast.error(
          result.test?.message ||
            "Token saved, but Cloudflare rejected it. Create a new API Token in My Profile → API Tokens.",
        );
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function testSaved(id: string) {
    try {
      const result = await api<{ ok: boolean; message?: string }>(`/api/cloudflare/${id}`, { method: "POST" });
      toast[result.ok ? "success" : "error"](result.ok ? "Connected" : result.message);
      queryClient.invalidateQueries({ queryKey: ["cloudflare"] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Test failed");
    }
  }

  return (
    <div>
      <PageHeader
        title="Cloudflare"
        description="DNS accounts used after every purchase. Nameservers stay on Cloudflare."
        actions={
          <Button
            onClick={() => {
              setEditingId(null);
              setForm(empty);
              setOpen(true);
            }}
          >
            + Add Cloudflare
          </Button>
        }
      />
      <div className="grid gap-3 md:grid-cols-2">
        {(data?.accounts ?? []).map((item) => (
          <Card key={item.id} className="space-y-2">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="font-medium">{item.name}</div>
                <div className="text-sm text-muted-foreground">Account: {item.accountShort || item.accountId}</div>
                <div className="text-sm text-muted-foreground">API token {item.credentials}</div>
              </div>
              <StatusBadge value={item.connectionStatus} />
            </div>
            <div className="text-sm">Zones: {item.zoneCount ?? item.domainCount ?? 0}</div>
            {item.lastError && <div className="text-sm text-destructive">{item.lastError}</div>}
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => testSaved(item.id)}>
                Test
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setEditingId(item.id);
                  setForm({ name: item.name, accountId: item.accountId, apiToken: "" });
                  setOpen(true);
                }}
              >
                Edit
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={async () => {
                  await api(`/api/cloudflare/${item.id}`, { method: "DELETE" });
                  queryClient.invalidateQueries({ queryKey: ["cloudflare"] });
                }}
              >
                Delete
              </Button>
            </div>
          </Card>
        ))}
      </div>
      <Dialog open={open} onClose={closeModal} title="Cloudflare account">
        <div className="grid gap-3">
          <Field label="Name">
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="CF Main" />
          </Field>
          <Field label="Account ID">
            <Input
              value={form.accountId}
              autoComplete="off"
              onChange={(e) => setForm({ ...form, accountId: e.target.value.trim() })}
              placeholder="32-character ID from the Cloudflare sidebar"
            />
            <p className="text-xs text-muted-foreground">
              dash.cloudflare.com → right sidebar → Account ID. Not the login email.
            </p>
          </Field>
          <Field label="API Token">
            <Input
              type="password"
              autoComplete="new-password"
              name="cloudflare-api-token"
              value={form.apiToken}
              onChange={(e) => setForm({ ...form, apiToken: e.target.value })}
              placeholder={editingId ? "Leave blank to keep the saved token" : "Paste token from My Profile → API Tokens"}
            />
            <p className="text-xs text-muted-foreground">
              Cloudflare → My Profile → API Tokens → Create Token. Permissions: Zone → Zone → Edit, Zone → DNS → Edit,
              Account → Account Settings → Read. Zone Resources must be All zones from this account — otherwise new
              domains cannot be added.
            </p>
          </Field>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" onClick={closeModal}>
            Cancel
          </Button>
          <Button disabled={saving} onClick={save}>
            {saving ? "Saving..." : "Save and test"}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
