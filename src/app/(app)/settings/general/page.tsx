"use client";

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { Card, Input } from "@/components/ui/primitives";
import { Field, Select } from "@/components/ui/dialog";
import { registrantLabel } from "@/lib/utils";
import { api } from "@/lib/api/client";

export default function GeneralSettingsPage() {
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey: ["settings"],
    queryFn: () => api<{ settings: Record<string, string | boolean | null> }>("/api/settings"),
  });
  const registrars = useQuery({ queryKey: ["registrars"], queryFn: () => api<{ registrars: Array<{ id: string; name: string }> }>("/api/registrars") });
  const buyers = useQuery({ queryKey: ["buyers"], queryFn: () => api<{ buyers: Array<{ id: string; name: string }> }>("/api/buyers") });
  const cf = useQuery({ queryKey: ["cloudflare"], queryFn: () => api<{ accounts: Array<{ id: string; name: string; domainCount: number }> }>("/api/cloudflare") });
  const registrants = useQuery({
    queryKey: ["registrants"],
    queryFn: () =>
      api<{ registrants: Array<{ id: string; name: string; label: string; registrar?: { name: string } | null }> }>("/api/registrants"),
  });
  const [form, setForm] = useState({
    defaultRegistrarId: "",
    defaultBuyerId: "",
    defaultCloudflareId: "",
    defaultRegistrantId: "",
    wwwRecordMode: "a",
    dnsProxied: true,
  });

  useEffect(() => {
    if (data?.settings) {
      setForm((curr) => ({
        ...curr,
        defaultRegistrarId: String(data.settings.defaultRegistrarId ?? ""),
        defaultBuyerId: String(data.settings.defaultBuyerId ?? ""),
        defaultCloudflareId: String(data.settings.defaultCloudflareId ?? ""),
        defaultRegistrantId: String(data.settings.defaultRegistrantId ?? ""),
        wwwRecordMode: String(data.settings.wwwRecordMode ?? "a"),
        dnsProxied: Boolean(data.settings.dnsProxied),
      }));
    }
  }, [data]);

  return (
    <div>
      <PageHeader title="General" description="Defaults for purchase and Cloudflare DNS records." />
      <Card className="grid max-w-xl gap-4">
        <Field label="Default registrar">
          <Select value={form.defaultRegistrarId} onChange={(e) => setForm({ ...form, defaultRegistrarId: e.target.value })}>
            <option value="">None</option>
            {(registrars.data?.registrars ?? []).map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Default buyer / team">
          <Select value={form.defaultBuyerId} onChange={(e) => setForm({ ...form, defaultBuyerId: e.target.value })}>
            <option value="">None</option>
            {(buyers.data?.buyers ?? []).map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Default Cloudflare">
          <Select value={form.defaultCloudflareId} onChange={(e) => setForm({ ...form, defaultCloudflareId: e.target.value })}>
            <option value="">None</option>
            {(cf.data?.accounts ?? []).map((item) => (
              <option key={item.id} value={item.id}>
                {item.name} · {item.domainCount} domains
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Default registrant profile">
          <Select value={form.defaultRegistrantId} onChange={(e) => setForm({ ...form, defaultRegistrantId: e.target.value })}>
            <option value="">None</option>
            {(registrants.data?.registrants ?? []).map((item) => (
              <option key={item.id} value={item.id}>
                {item.registrar?.name ? `${registrantLabel(item)} (${item.registrar.name})` : item.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="WWW record">
          <Select value={form.wwwRecordMode} onChange={(e) => setForm({ ...form, wwwRecordMode: e.target.value })}>
            <option value="a">A record to server IP</option>
            <option value="cname">CNAME www → domain</option>
          </Select>
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={form.dnsProxied}
            onChange={(e) => setForm({ ...form, dnsProxied: e.target.checked })}
          />
          Proxy Cloudflare DNS (orange cloud) when adding to Keitaro or Hestia
        </label>
        <Button
          onClick={async () => {
            try {
              await api("/api/settings", {
                method: "PATCH",
                body: JSON.stringify({
                  defaultRegistrarId: form.defaultRegistrarId || null,
                  defaultBuyerId: form.defaultBuyerId || null,
                  defaultCloudflareId: form.defaultCloudflareId || null,
                  defaultRegistrantId: form.defaultRegistrantId || null,
                  wwwRecordMode: form.wwwRecordMode,
                  dnsProxied: form.dnsProxied,
                }),
              });
              toast.success("Settings saved");
              queryClient.invalidateQueries({ queryKey: ["settings"] });
            } catch (error) {
              toast.error(error instanceof Error ? error.message : "Save failed");
            }
          }}
        >
          Save
        </Button>
      </Card>
    </div>
  );
}
