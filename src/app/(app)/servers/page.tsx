"use client";
import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/layout/app-shell";
import { HestiaAssignDialog } from "@/components/assign-server-dialogs";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card, Input } from "@/components/ui/primitives";
import { Dialog } from "@/components/ui/dialog";
import { api } from "@/lib/api/client";

type Server = { id: string; name: string; ipAddress?: string | null; enabled: boolean; domainCount: number; connectionStatus: string; lastError?: string | null };
type Domain = { id: string; domain: string; status: string; hestia?: { server: { id: string }; status: string } | null };
export default function HostingServersPage() {
  const [target, setTarget] = useState<Server | null>(null);
  const hs = useQuery({ queryKey: ["hestia"], queryFn: () => api<{ servers: Server[] }>("/api/hestia") });
  const ds = useQuery({ queryKey: ["domains"], queryFn: () => api<{ domains: Domain[] }>("/api/domains"), enabled: Boolean(target) });
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<{ user: { role: string } }>("/api/auth/me") });
  const admin = me.data?.user.role === "admin";
  const [ids, setIds] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [assigning, setAssigning] = useState(false);
  const candidates = (ds.data?.domains ?? []).filter(d => ["purchased", "active"].includes(d.status) && !(d.hestia?.server.id === target?.id && d.hestia?.status === "active") && d.domain.includes(search.trim().toLowerCase()));
  return <div>
    <PageHeader title="Servers" description="Add purchased domains to a hosting server and configure DNS."
      actions={admin && <Link className="text-sm text-primary underline" href="/settings/servers">Manage servers</Link>} />
    {hs.isLoading && <p>Loading servers…</p>}
    {hs.error && <p role="alert" className="text-destructive">Could not load servers.</p>}
    {hs.data && !hs.data.servers.length && <Card>{admin ? <Link href="/settings/servers" className="underline">Connect a server in Settings → Servers</Link> : "Ask an administrator to connect a server first."}</Card>}
    <div className="grid gap-3 lg:grid-cols-2">{(hs.data?.servers ?? []).map(server => <Card key={server.id} data-server-card>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0"><h2 className="truncate font-semibold">{server.name}</h2><p className="mt-1 text-sm text-muted-foreground">{server.ipAddress || "IP address required"}</p></div>
        <StatusBadge value={server.connectionStatus} />
      </div>
      {server.lastError && <p className="mt-2 text-sm text-destructive">{server.lastError}</p>}
      <div className="mt-4 flex items-center justify-between gap-3">
        <span className="text-xs text-muted-foreground">{server.domainCount} {server.domainCount === 1 ? "domain" : "domains"}</span>
        <Button size="sm" disabled={!server.enabled || !server.ipAddress} onClick={() => { setTarget(server); setIds([]); setSearch(""); setAssigning(false); }}>Add domains</Button>
      </div>
    </Card>)}</div>
    <Dialog open={Boolean(target) && !assigning} onClose={() => setTarget(null)} title={`Add domains to ${target?.name ?? "server"}`}>
      <Input aria-label="Search domains" placeholder="Search purchased domains" value={search} onChange={e => setSearch(e.target.value)} />
      {ds.isLoading && <p className="my-4 text-sm text-muted-foreground">Loading domains…</p>}
      {ds.error && <p role="alert" className="my-4 text-sm text-destructive">Could not load domains. <button className="underline" onClick={() => ds.refetch()}>Retry</button></p>}
      <div className="my-4 max-h-72 space-y-2 overflow-auto">{candidates.map(d => <label className="flex items-center gap-2 text-sm" key={d.id}><input type="checkbox" checked={ids.includes(d.id)} disabled={ids.length >= 100 && !ids.includes(d.id)} onChange={e => setIds(old => e.target.checked ? [...old, d.id] : old.filter(id => id !== d.id))} />{d.domain}</label>)}{!ds.isLoading && !ds.error && !candidates.length && <p>No matching domains. Add an existing domain in Purchased domains first.</p>}</div>
      <div className="flex items-center justify-between"><span className="text-sm">{ids.length} selected · up to 100</span><Button disabled={!ids.length || ds.isLoading || Boolean(ds.error)} onClick={() => setAssigning(true)}>Continue</Button></div>
    </Dialog>
    <HestiaAssignDialog open={Boolean(target) && assigning} initialServerId={target?.id} domainIds={ids} domains={ids.map(id => ds.data?.domains.find(d => d.id === id)?.domain ?? id)} onClose={() => { setTarget(null); setAssigning(false); }} />
  </div>;
}
