"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { DomainManagementDialog, TxtRecordDialog } from "@/components/domain-management-dialogs";
import { HestiaAssignDialog, KeitaroAssignDialog } from "@/components/assign-server-dialogs";
import { PageHeader } from "@/components/layout/app-shell";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/primitives";
import { Dialog, Select } from "@/components/ui/dialog";
import { api } from "@/lib/api/client";
import { formatDate, formatDateTime, formatMoney } from "@/lib/utils";

type DomainDetails = {
  id: string;
  domain: string;
  status: string;
  purchasePrice: number;
  currency: string;
  registeredAt?: string;
  purchasedAt?: string;
  nameservers: string[];
  errorMessage?: string;
  registrar: { id: string; name: string };
  buyerGroup: { id: string; name: string } | null;
  buyer: { id: string; name: string; keitaroGroup?: string | null; stageName?: string | null } | null;
  cloudflare: {
    status: string;
    nameservers: string[];
    zoneId?: string | null;
    errorMessage?: string | null;
    account: { id: string; name: string };
  } | null;
  dns: { ip: string | null; records: Array<{ id: string; type: string; name: string; content: string }> };
  keitaro: { status: string; groupName?: string | null; serverIp?: string | null; errorMessage?: string | null; server: { id: string; name: string } } | null;
  hestia: { status: string; ip?: string | null; webUser?: string | null; server: { id: string; name: string } } | null;
  activityLogs: Array<{ id: string; message: string; createdAt: string; level: string }>;
};

export default function DomainDetailsPage() {
  const params = useParams<{ name: string }>();
  const queryClient = useQueryClient();
  const name = decodeURIComponent(params.name);
  const { data } = useQuery({
    queryKey: ["domain", name],
    queryFn: () => api<{ domain: DomainDetails }>(`/api/domains/${name}`),
  });
  const { data: cf } = useQuery({
    queryKey: ["cloudflare"],
    queryFn: () => api<{ accounts: Array<{ id: string; name: string; domainCount: number }> }>("/api/cloudflare"),
  });
  const [managementOpen, setManagementOpen] = useState(false);
  const [txtOpen, setTxtOpen] = useState(false);
  const [modal, setModal] = useState<"kt" | "hs" | "cf" | null>(null);
  const [target, setTarget] = useState("");
  const domain = data?.domain;

  async function run(path: string, body: object) {
    if (!domain) return;
    try {
      await api(path, { method: "POST", body: JSON.stringify(body) });
      toast.success("Done");
      setModal(null);
      queryClient.invalidateQueries({ queryKey: ["domain", name] });
      queryClient.invalidateQueries({ queryKey: ["cloudflare"] });
      queryClient.invalidateQueries({ queryKey: ["domains"] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Action failed");
    }
  }

  if (!domain) return <div>Loading...</div>;

  return (
    <div>
      <PageHeader title={domain.domain} actions={<div className="flex items-center gap-2"><StatusBadge value={domain.status} /><Button variant="outline" onClick={() => setManagementOpen(true)}>Update</Button><Button variant="outline" disabled={!domain.cloudflare?.zoneId} onClick={() => setTxtOpen(true)}>Add TXT</Button></div>} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="space-y-1 text-sm">
          <div className="font-medium">Purchase</div>
          <div>Registrar: {domain.registrar.name}</div>
          <div>Price: {formatMoney(domain.purchasePrice, domain.currency)}</div>
          <div>Buyer: {domain.buyer?.name ?? "—"}</div>
          <div>Purchased: {formatDate(domain.purchasedAt || domain.registeredAt)}</div>
          {domain.errorMessage && <div className="text-destructive">{domain.errorMessage}</div>}
        </Card>
        <Card className="space-y-2 text-sm">
          <div className="font-medium">Cloudflare</div>
          {domain.cloudflare ? (
            <>
              <div>Account: {domain.cloudflare.account.name}</div>
              <div>
                Status: <StatusBadge value={domain.cloudflare.status} />
              </div>
              <div>Zone ID: {domain.cloudflare.zoneId || "—"}</div>
              <div className="font-mono text-xs">
                Nameservers
                <div className="mt-1">{domain.cloudflare.nameservers.join("\n") || "—"}</div>
              </div>
              {domain.cloudflare.errorMessage && <div className="text-destructive">{domain.cloudflare.errorMessage}</div>}
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={() => run(`/api/domains/${domain.id}/refresh`, {})}>
                  Refresh status
                </Button>
                {domain.cloudflare.status === "failed" && (
                  <Button
                    variant="outline"
                    onClick={() =>
                      run(`/api/domains/${domain.id}/cloudflare`, {
                        accountId: domain.cloudflare!.account.id,
                      })
                    }
                  >
                    Retry Cloudflare
                  </Button>
                )}
                {domain.cloudflare.status === "failed" && domain.cloudflare.nameservers.length >= 2 && (
                  <Button
                    variant="outline"
                    onClick={() =>
                      run(`/api/domains/${domain.id}/nameservers`, {
                        nameservers: domain.cloudflare!.nameservers,
                      })
                    }
                  >
                    Retry nameserver update
                  </Button>
                )}
              </div>
            </>
          ) : (
            <Button variant="outline" onClick={() => setModal("cf")}>
              Add to Cloudflare
            </Button>
          )}
        </Card>
        <Card className="space-y-2 text-sm">
          <div className="font-medium">DNS</div>
          {(domain.dns?.records ?? []).map((record) => (
            <div key={record.id} className="flex gap-3 font-mono text-xs">
              <span>{record.type}</span>
              <span>{record.name}</span>
              <span>{record.content}</span>
            </div>
          ))}
          {!domain.dns?.records?.length && <div className="text-muted-foreground">No DNS records yet.</div>}
        </Card>
        <Card className="space-y-2 text-sm">
          <div className="font-medium">Server</div>
          {domain.keitaro ? (
            <>
              <div>Type: Keitaro</div>
              <div>Server: {domain.keitaro.server.name}</div>
              <div>Group: {domain.keitaro.groupName || "—"}</div>
              <div>
                Status: <StatusBadge value={domain.keitaro.status} />
              </div>
              {domain.keitaro.errorMessage && <div role="alert" className="text-destructive">{domain.keitaro.errorMessage}</div>}
              {domain.keitaro.status === "failed" && (
                <Button variant="outline" onClick={() => run(`/api/domains/${domain.id}/keitaro`, { serverId: domain.keitaro!.server.id, group: domain.keitaro!.groupName })}>
                  Retry Keitaro
                </Button>
              )}
            </>
          ) : domain.hestia ? (
            <>
              <div>Type: Hestia</div>
              <div>Server: {domain.hestia.server.name}</div>
              <div>
                Status: <StatusBadge value={domain.hestia.status} />
              </div>
            </>
          ) : (
            <div className="flex gap-2">
              <Button onClick={() => setModal("kt")}>Add to Keitaro</Button>
              <Button variant="outline" onClick={() => setModal("hs")}>
                Add to Hestia
              </Button>
            </div>
          )}
        </Card>
      </div>
      <h2 className="mt-8 mb-3 text-lg font-semibold">Activity</h2>
      <Card className="space-y-2">
        {domain.activityLogs.map((log) => (
          <div key={log.id} className="flex gap-3 text-sm">
            <span className="w-40 text-muted-foreground">{formatDateTime(log.createdAt)}</span>
            <span>{log.message}</span>
          </div>
        ))}
        {!domain.activityLogs.length && <div className="text-sm text-muted-foreground">No activity yet.</div>}
      </Card>
      {managementOpen && <DomainManagementDialog domain={domain} onClose={() => setManagementOpen(false)} />}
      {txtOpen && <TxtRecordDialog domain={domain} onClose={() => setTxtOpen(false)} />}
      <KeitaroAssignDialog
        open={modal === "kt"}
        onClose={() => setModal(null)}
        domainIds={[domain.id]}
        domains={[domain.domain]}
        groupHint={domain.buyer?.keitaroGroup || domain.buyer?.stageName}
        onDone={() => queryClient.invalidateQueries({ queryKey: ["domain", name] })}
      />
      <HestiaAssignDialog
        open={modal === "hs"}
        onClose={() => setModal(null)}
        domainIds={[domain.id]}
        domains={[domain.domain]}
        onDone={() => queryClient.invalidateQueries({ queryKey: ["domain", name] })}
      />
      <Dialog open={modal === "cf"} onClose={() => setModal(null)} title="Add domain to Cloudflare">
        <Select value={target} onChange={(e) => setTarget(e.target.value)}>
          <option value="">Select account</option>
          {(cf?.accounts ?? []).map((item) => (
            <option key={item.id} value={item.id}>
              {item.name} · {item.domainCount} domains
            </option>
          ))}
        </Select>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" onClick={() => setModal(null)}>
            Cancel
          </Button>
          <Button disabled={!target} onClick={() => run(`/api/domains/${domain.id}/cloudflare`, { accountId: target })}>
            Add domain
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
