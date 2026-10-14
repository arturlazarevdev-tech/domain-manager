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

type Server = {
  id: string;
  name: string;
  url: string;
  credentials: string;
  connectionStatus: string;
  username?: string;
  ipAddress?: string | null;
  lastError?: string | null;
};

export default function ServersSettingsPage() {
  const queryClient = useQueryClient();
  const kt = useQuery({ queryKey: ["keitaro"], queryFn: () => api<{ servers: Server[] }>("/api/keitaro") });
  const hs = useQuery({ queryKey: ["hestia"], queryFn: () => api<{ servers: Server[] }>("/api/hestia") });
  const [keitaroOpen, setKeitaroOpen] = useState(false);
  const [hestiaOpen, setHestiaOpen] = useState(false);
  const [ktEditing, setKtEditing] = useState<string | null>(null);
  const [hsEditing, setHsEditing] = useState<string | null>(null);
  const [ktForm, setKtForm] = useState({ name: "KT-01", url: "https://tracker.example.com", ipAddress: "", apiKey: "" });
  const [hsForm, setHsForm] = useState({
    name: "WEB-01",
    url: "https://server.example.com:8083",
    ipAddress: "",
    username: "admin",
    accessKey: "",
    secretKey: "",
  });

  return (
    <div>
      <PageHeader title="Servers" description="IP addresses are used to create Cloudflare DNS records." />
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold">Keitaro</h2>
        <Button
          onClick={() => {
            setKtEditing(null);
            setKtForm({ name: "KT-01", url: "https://tracker.example.com", ipAddress: "", apiKey: "" });
            setKeitaroOpen(true);
          }}
        >
          Add
        </Button>
      </div>
      <div className="mb-8 grid gap-3">
        {(kt.data?.servers ?? []).map((item) => (
          <Card key={item.id} className="flex items-center justify-between gap-3">
            <div>
              <div className="font-medium">{item.name}</div>
              <div className="text-sm text-muted-foreground">{item.url}</div>
              <div className="text-sm">IP address: {item.ipAddress || "—"}</div>
              <div className="text-sm text-muted-foreground">API key {item.credentials}</div>
            </div>
            <div className="flex items-center gap-2">
              <StatusBadge value={item.connectionStatus} />
              <Button
                variant="outline"
                onClick={async () => {
                  const result = await api<{ ok: boolean; message?: string }>(`/api/keitaro/${item.id}`, { method: "POST" });
                  toast[result.ok ? "success" : "error"](result.ok ? "Connected" : result.message);
                  queryClient.invalidateQueries({ queryKey: ["keitaro"] });
                }}
              >
                Test
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setKtEditing(item.id);
                  setKtForm({ name: item.name, url: item.url, ipAddress: item.ipAddress ?? "", apiKey: "" });
                  setKeitaroOpen(true);
                }}
              >
                Edit
              </Button>
            </div>
          </Card>
        ))}
      </div>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold">Hestia</h2>
        <Button
          onClick={() => {
            setHsEditing(null);
            setHsForm({
              name: "WEB-01",
              url: "https://server.example.com:8083",
              ipAddress: "",
              username: "admin",
              accessKey: "",
              secretKey: "",
            });
            setHestiaOpen(true);
          }}
        >
          Add
        </Button>
      </div>
      <div className="grid gap-3">
        {(hs.data?.servers ?? []).map((item) => (
          <Card key={item.id} className="flex items-center justify-between gap-3">
            <div>
              <div className="font-medium">{item.name}</div>
              <div className="text-sm text-muted-foreground">{item.url}</div>
              <div className="text-sm">IP address: {item.ipAddress || "—"}</div>
              <div className="text-sm text-muted-foreground">Username {item.username} · {item.credentials}</div>
            </div>
            <div className="flex items-center gap-2">
              <StatusBadge value={item.connectionStatus} />
              <Button
                variant="outline"
                onClick={async () => {
                  const result = await api<{ ok: boolean; message?: string }>(`/api/hestia/${item.id}`, { method: "POST" });
                  toast[result.ok ? "success" : "error"](result.ok ? "Connected" : result.message);
                  queryClient.invalidateQueries({ queryKey: ["hestia"] });
                }}
              >
                Test
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setHsEditing(item.id);
                  setHsForm({
                    name: item.name,
                    url: item.url,
                    ipAddress: item.ipAddress ?? "",
                    username: item.username || "admin",
                    accessKey: "",
                    secretKey: "",
                  });
                  setHestiaOpen(true);
                }}
              >
                Edit
              </Button>
            </div>
          </Card>
        ))}
      </div>
      <Dialog open={keitaroOpen} onClose={() => setKeitaroOpen(false)} title={ktEditing ? "Edit Keitaro server" : "Add Keitaro server"}>
        <div className="grid gap-3">
          <Field label="Name">
            <Input value={ktForm.name} onChange={(e) => setKtForm({ ...ktForm, name: e.target.value })} />
          </Field>
          <Field label="URL">
            <Input value={ktForm.url} onChange={(e) => setKtForm({ ...ktForm, url: e.target.value })} />
          </Field>
          <Field label="IP address">
            <Input value={ktForm.ipAddress} onChange={(e) => setKtForm({ ...ktForm, ipAddress: e.target.value })} placeholder="185.123.45.67" />
          </Field>
          <Field label="API key">
            <Input type="password" value={ktForm.apiKey} onChange={(e) => setKtForm({ ...ktForm, apiKey: e.target.value })} placeholder={ktEditing ? "Leave blank to keep" : ""} />
          </Field>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" onClick={() => setKeitaroOpen(false)}>
            Cancel
          </Button>
          <Button
            onClick={async () => {
              try {
                if (ktEditing) {
                  await api(`/api/keitaro/${ktEditing}`, { method: "PATCH", body: JSON.stringify(ktForm) });
                } else {
                  await api("/api/keitaro", { method: "POST", body: JSON.stringify(ktForm) });
                }
                toast.success("Saved");
                setKeitaroOpen(false);
                queryClient.invalidateQueries({ queryKey: ["keitaro"] });
              } catch (error) {
                toast.error(error instanceof Error ? error.message : "Save failed");
              }
            }}
          >
            Save
          </Button>
        </div>
      </Dialog>
      <Dialog open={hestiaOpen} onClose={() => setHestiaOpen(false)} title={hsEditing ? "Edit Hestia server" : "Add Hestia server"}>
        <div className="grid gap-3">
          <Field label="Name">
            <Input value={hsForm.name} onChange={(e) => setHsForm({ ...hsForm, name: e.target.value })} />
          </Field>
          <Field label="URL">
            <Input value={hsForm.url} onChange={(e) => setHsForm({ ...hsForm, url: e.target.value })} />
          </Field>
          <Field label="IP address">
            <Input value={hsForm.ipAddress} onChange={(e) => setHsForm({ ...hsForm, ipAddress: e.target.value })} placeholder="46.20.123.55" />
          </Field>
          <Field label="Username">
            <Input value={hsForm.username} onChange={(e) => setHsForm({ ...hsForm, username: e.target.value })} />
          </Field>
          <Field label="Access key">
            <Input value={hsForm.accessKey} onChange={(e) => setHsForm({ ...hsForm, accessKey: e.target.value })} placeholder={hsEditing ? "Leave blank to keep" : ""} />
          </Field>
          <Field label="Secret key">
            <Input type="password" value={hsForm.secretKey} onChange={(e) => setHsForm({ ...hsForm, secretKey: e.target.value })} placeholder={hsEditing ? "Leave blank to keep" : ""} />
          </Field>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" onClick={() => setHestiaOpen(false)}>
            Cancel
          </Button>
          <Button
            onClick={async () => {
              try {
                if (hsEditing) {
                  await api(`/api/hestia/${hsEditing}`, { method: "PATCH", body: JSON.stringify(hsForm) });
                } else {
                  await api("/api/hestia", { method: "POST", body: JSON.stringify(hsForm) });
                }
                toast.success("Saved");
                setHestiaOpen(false);
                queryClient.invalidateQueries({ queryKey: ["hestia"] });
              } catch (error) {
                toast.error(error instanceof Error ? error.message : "Save failed");
              }
            }}
          >
            Save
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
