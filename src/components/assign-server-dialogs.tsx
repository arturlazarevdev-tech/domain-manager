"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, Field, Select } from "@/components/ui/dialog";
import { api } from "@/lib/api/client";

type Server = { id: string; name: string; ipAddress?: string | null; username?: string; enabled?: boolean };
type AssignmentResult = { id: string; domain?: string; ok: boolean; error?: string };

export function KeitaroAssignDialog(props: Parameters<typeof KeitaroAssignForm>[0]) {
  return props.open ? <KeitaroAssignForm {...props} /> : null;
}

function KeitaroAssignForm({
  open,
  onClose,
  domainIds,
  domains,
  groupHint,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  domainIds: string[];
  domains?: string[];
  groupHint?: string | null;
  onDone?: () => void;
}) {
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey: ["keitaro"],
    queryFn: () => api<{ servers: Server[] }>("/api/keitaro"),
    enabled: open,
  });
  const { data: buyers } = useQuery({
    queryKey: ["buyers"],
    queryFn: () => api<{ buyers: Array<{ id: string; name: string }> }>("/api/buyers"),
    enabled: open,
  });
  const [serverChoice, setServerId] = useState("");
  const serverId = serverChoice || data?.servers[0]?.id || "";
  const [buyerChoice, setBuyerId] = useState("");
  const [allowIndexing, setAllowIndexing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [failures, setFailures] = useState<AssignmentResult[]>([]);
  const server = (data?.servers ?? []).find((item) => item.id === serverId);
  const buyerList = buyers?.buyers ?? [];
  const buyerId = buyerChoice || buyerList.find(item => item.name.toLowerCase() === (groupHint ?? "").toLowerCase())?.id || buyerList[0]?.id || "";
  const selectedBuyer = buyerList.find((item) => item.id === buyerId);
  const group = selectedBuyer?.name ?? "";

  async function submit() {
    setLoading(true);
    setFailures([]);
    try {
      const path = domainIds.length === 1 ? `/api/domains/${domainIds[0]}/keitaro` : "/api/domains/bulk/keitaro";
      const body =
        domainIds.length === 1
          ? { serverId, group: group || null, allowIndexing }
          : { domainIds, serverId, group: group || null, allowIndexing };
      if (domainIds.length > 1) {
        const result = await api<{ results: AssignmentResult[] }>(path, { method: "POST", body: JSON.stringify(body) });
        if (result.results.length !== domainIds.length || domainIds.some((id) => !result.results.some((item) => item.id === id))) {
          throw new Error("Keitaro did not return a result for every selected domain");
        }
        const failed = result.results.filter((item) => !item.ok);
        if (failed.length) {
          setFailures(failed);
          toast.error(`${result.results.length - failed.length} of ${domainIds.length} domains added to Keitaro; ${failed.length} failed`);
          refreshDomains();
          return;
        }
      } else {
        await api(path, { method: "POST", body: JSON.stringify(body) });
      }
      toast.success(domainIds.length === 1 ? "Added to Keitaro" : `${domainIds.length} domains added to Keitaro`);
      setAllowIndexing(false);
      onClose();
      onDone?.();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Keitaro failed");
      refreshDomains();
    } finally {
      setLoading(false);
    }
  }

  function close() {
    setAllowIndexing(false);
    setFailures([]);
    onClose();
  }

  function refreshDomains() {
    queryClient.invalidateQueries({ queryKey: ["domains"] });
    queryClient.invalidateQueries({ queryKey: ["domain"] });
    queryClient.invalidateQueries({ queryKey: ["job"] });
  }

  return (
    <Dialog open={open} onClose={close} title="Add domain to Keitaro">
      <div className="grid gap-3 text-sm">
        {domains?.length === 1 && (
          <div>
            <div className="text-muted-foreground">Domain</div>
            <div className="font-medium">{domains[0]}</div>
          </div>
        )}
        <Field label="Keitaro server">
          <Select value={serverId} onChange={(e) => setServerId(e.target.value)}>
            {(data?.servers ?? []).map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Buyer group">
          <Select value={buyerId} onChange={(e) => setBuyerId(e.target.value)}>
            {!buyerList.length && <option value="">No buyers</option>}
            {buyerList.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </Select>
        </Field>
        <div>
          <div className="text-muted-foreground">IP</div>
          <div className="font-medium">{server?.ipAddress || "Set IP in Settings → Servers"}</div>
        </div>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={allowIndexing} onChange={(e) => setAllowIndexing(e.target.checked)} disabled={loading} />
          Allow search engine indexing
        </label>
        {domainIds.length > 1 && (
          <div>
            <div className="text-muted-foreground">Domains</div>
            <div className="font-medium">{domainIds.length}</div>
          </div>
        )}
        {failures.length > 0 && (
          <div role="alert" className="max-h-48 space-y-1 overflow-auto text-destructive">
            {failures.map((item) => <div key={item.id}><strong>{item.domain || "Domain"}:</strong> {item.error || "Failed to add to Keitaro"}</div>)}
          </div>
        )}
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="outline" onClick={close}>
          Cancel
        </Button>
        <Button disabled={!serverId || loading || domainIds.length === 0} onClick={submit}>
          {loading ? "Adding..." : domainIds.length > 1 ? `Add ${domainIds.length} Domains` : "Add"}
        </Button>
      </div>
    </Dialog>
  );
}

export function HestiaAssignDialog(props: Parameters<typeof HostingAssignForm>[0]) {
  return props.open ? <HostingAssignForm key={props.initialServerId ?? "hosting"} {...props} /> : null;
}

function HostingAssignForm({ open, onClose, domainIds, domains, onDone, initialServerId }: {
  open: boolean; onClose: () => void; domainIds: string[]; domains?: string[]; onDone?: () => void; initialServerId?: string;
}) {
  const client = useQueryClient();
  const hs = useQuery({ queryKey: ["hestia"], queryFn: () => api<{ servers: Server[] }>("/api/hestia"), enabled: open });
  const cf = useQuery({ queryKey: ["cloudflare"], queryFn: () => api<{ accounts: Array<{ id: string; name: string; enabled: boolean }> }>("/api/cloudflare"), enabled: open });
  const [serverId, setServerId] = useState(initialServerId ?? "");
  const [accountId, setAccountId] = useState("");
  const [loading, setLoading] = useState(false);
  const [failures, setFailures] = useState<AssignmentResult[]>([]);
  const servers = (hs.data?.servers ?? []).filter(s => s.enabled !== false);
  const server = servers.find(s => s.id === serverId);
  async function submit() {
    if (!server || loading) return;
    setLoading(true); setFailures([]);
    try {
      const bulk = domainIds.length > 1;
      const result = await api<{ results?: AssignmentResult[] }>(bulk ? "/api/domains/bulk/server" : `/api/domains/${domainIds[0]}/server`, {
        method: "POST", body: JSON.stringify({ serverId, webUser: server.username, cloudflareAccountId: accountId || undefined, ...(bulk ? { domainIds } : {}) }),
      });
      if (bulk) {
        if (!result.results || result.results.length !== domainIds.length || domainIds.some(id => !result.results!.some(row => row.id === id))) throw new Error("Missing results for selected domains");
        const failed = result.results.filter(row => !row.ok);
        if (failed.length) { setFailures(failed); toast.error(`${result.results.length - failed.length} added; ${failed.length} failed`); return; }
      }
      toast.success(`Added to ${server.name}`); onClose(); onDone?.();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Server setup failed"); }
    finally { setLoading(false); for (const key of ["domains", "domain", "job", "hestia", "cloudflare", "dashboard"]) client.invalidateQueries({ queryKey: [key] }); }
  }
  return <Dialog open={open} onClose={() => { if (!loading) onClose(); }} title="Add domains to server">
    <div className="grid gap-3 text-sm">
      <p>Create websites on the server and point root and www DNS records to its IP address.</p>
      {domains?.length === 1 && <strong>{domains[0]}</strong>}
      <Field label="Server"><Select value={serverId} disabled={loading || Boolean(initialServerId)} onChange={e => setServerId(e.target.value)}>
        <option value="">{hs.isLoading ? "Loading…" : "Select server"}</option>
        {servers.map(s => <option key={s.id} value={s.id}>{s.name} · {s.ipAddress || "IP required"}</option>)}
      </Select></Field>
      {hs.error && <p role="alert" className="text-destructive">Could not load servers.</p>}
      {!hs.isLoading && !hs.error && !servers.length && <p>Ask an administrator to connect a hosting server first.</p>}
      <Field label="Cloudflare for domains without DNS setup"><Select value={accountId} disabled={loading} onChange={e => setAccountId(e.target.value)}>
        <option value="">Use each domain’s existing account</option>
        {(cf.data?.accounts ?? []).filter(a => a.enabled).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
      </Select></Field>
      {cf.error && <p role="alert" className="text-destructive">Could not load Cloudflare accounts.</p>}
      <p className="text-muted-foreground">Existing Cloudflare zones keep their account. For domains without a zone, select an account to create it and update nameservers.</p>
      <p>{domainIds.length} domains selected · maximum 100 per batch.</p>
      {failures.length > 0 && <div role="alert" className="max-h-48 overflow-auto text-destructive">{failures.map(f => <p key={f.id}><strong>{f.domain || domains?.[domainIds.indexOf(f.id)] || f.id}:</strong> {f.error}</p>)}</div>}
    </div>
    <div className="mt-4 flex justify-end gap-2"><Button variant="outline" disabled={loading} onClick={onClose}>Cancel</Button><Button disabled={!server?.ipAddress || loading || !domainIds.length || domainIds.length > 100} onClick={submit}>{loading ? "Setting up…" : "Add domains"}</Button></div>
  </Dialog>;
}
