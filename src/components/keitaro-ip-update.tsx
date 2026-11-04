"use client";

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, Field } from "@/components/ui/dialog";
import { Input } from "@/components/ui/primitives";
import { api } from "@/lib/api/client";
import type { IpUpdateResult } from "@/lib/services/keitaro-ip";

type Job = { id: string; status: string; error?: string | null; payload: { ip: string; domainIds: string[] }; result?: { results: IpUpdateResult[] } | null };

export function KeitaroIpUpdate({ server }: { server: { id: string; name: string; ipAddress?: string | null; domainCount?: number } }) {
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const [ip, setIp] = useState(server.ipAddress ?? "");
  const [saving, setSaving] = useState(false);
  const query = useQuery({
    queryKey: ["keitaro-ip", server.id],
    queryFn: () => api<{ job: Job | null }>(`/api/keitaro/${server.id}/ip`),
    enabled: open,
    refetchInterval: q => {
      const status = q.state.data?.job?.status;
      return status === "queued" || status === "running" ? 1500 : false;
    },
  });
  const job = query.data?.job;
  const running = job?.status === "queued" || job?.status === "running";
  const results = job?.result?.results ?? [];
  useEffect(() => {
    if (job?.status === "completed" || job?.status === "failed") {
      for (const key of ["keitaro", "domains", "domain", "dashboard"]) client.invalidateQueries({ queryKey: [key] });
    }
  }, [client, job?.id, job?.status]);
  return <>
    <Button variant="outline" onClick={() => { setIp(server.ipAddress ?? ""); setOpen(true); }}>Update all domain IPs</Button>
    <Dialog open={open} onClose={() => setOpen(false)} title={`Update IP — ${server.name}`}>
      <p className="mb-3 text-sm">Updates the server IP and root/www A records for all {server.domainCount ?? "linked"} domains assigned to this Keitaro server. Preserves proxy mode, TTL, TXT/MX and other subdomains. Existing www aliases to the root are preserved.</p>
      <Field label="New IPv4 address"><Input value={ip} disabled={Boolean(running || saving)} onChange={e => setIp(e.target.value)} placeholder="68.183.223.18" /></Field>
      <p className="mt-2 text-xs text-muted-foreground">Runs in the background; you can close this window and reopen it to view results. Domains without linked Cloudflare DNS or with conflicting IPv6/aliases show an error.</p>
      {query.isError && <p role="alert" className="mt-3 text-sm text-destructive">Could not load the previous update. Reopen this window to retry.</p>}
      {job && <div className="mt-4 text-sm" aria-live="polite">
        <p>Last update → {job.payload.ip}: {job.status}. Checked {results.length} / {job.payload.domainIds.length}; successful {results.filter(r => r.ok).length}, failed {results.filter(r => !r.ok).length}.</p>
        {job.error && <p role="alert" className="text-destructive">{job.error}</p>}
        <div className="mt-2 max-h-56 overflow-auto">{results.map(r => <div key={r.domainId} className={r.ok ? "" : "text-destructive"}>{r.domain}: {r.ok ? "DNS verified" : r.error}</div>)}</div>
      </div>}
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="outline" onClick={() => setOpen(false)}>Close</Button>
        <Button disabled={Boolean(saving || running || query.isPending || query.isError || !ip.trim())} onClick={async () => {
          setSaving(true);
          try {
            const response = await api<{ job: Job }>(`/api/keitaro/${server.id}/ip`, { method: "POST", body: JSON.stringify({ ip }) });
            client.setQueryData(["keitaro-ip", server.id], response);
            for (const key of ["keitaro", "domains", "domain", "dashboard"]) client.invalidateQueries({ queryKey: [key] });
            toast.success("IP update queued");
          } catch (error) { toast.error(error instanceof Error ? error.message : "Could not start update"); await query.refetch(); }
          finally { setSaving(false); }
        }}>{running ? "Updating…" : saving ? "Starting…" : "Update all domains"}</Button>
      </div>
    </Dialog>
  </>;
}
