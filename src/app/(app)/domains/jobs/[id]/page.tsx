"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import { toast } from "sonner";
import { HestiaAssignDialog, KeitaroAssignDialog } from "@/components/assign-server-dialogs";
import { PageHeader } from "@/components/layout/app-shell";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/primitives";
import { Table, THead, Th, Td } from "@/components/ui/table";
import { api } from "@/lib/api/client";
import type { PurchaseJobPayload } from "@/lib/jobs/types";
import { cn, formatDateTime } from "@/lib/utils";

type Job = {
  id: string;
  status: string;
  error?: string | null;
  payload?: PurchaseJobPayload;
  progress?: {
    total: number;
    completed: number;
    items: Array<{ domain: string; status: string; error?: string; step?: string; domainId?: string }>;
  };
  result?: { purchased: number; failed: number; total: number };
};

type ActivityLog = {
  id: string;
  action: string;
  message: string;
  level: string;
  createdAt: string;
};

type DomainRow = {
  id: string;
  domain: string;
  cloudflare: { status: string; account: { id: string; name: string }; errorMessage?: string | null } | null;
  dns: { ip: string | null };
  server: { name: string } | null;
  group: string | null;
  buyer: { keitaroGroup?: string | null; stageName?: string | null } | null;
};

export default function JobPage() {
  const params = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const logRef = useRef<HTMLDivElement>(null);
  const { data } = useQuery({
    queryKey: ["job", params.id],
    queryFn: () =>
      api<{ job: Job; domains: DomainRow[]; activityLogs: ActivityLog[] }>(`/api/jobs/${params.id}`),
    refetchInterval: (query) => {
      const status = query.state.data?.job.status;
      return status === "completed" || status === "failed" ? false : 1000;
    },
  });
  const [selected, setSelected] = useState<string[]>([]);
  const [modal, setModal] = useState<"kt" | "hs" | null>(null);
  const job = data?.job;
  const items = job?.progress?.items ?? [];
  const domains = data?.domains ?? [];
  const domainsById = new Map(domains.map((row) => [row.id, row]));
  const payload = job?.payload;
  const logs = data?.activityLogs ?? [];
  const done = items.filter((i) => i.status === "purchased").length;
  const pendingRegistrations = items.filter((i) => i.status === "pending").length;
  const purchased = domains.filter((row) => selected.includes(row.id));
  const cfTargets = (selected.length ? purchased : domains).filter(
    (row) => row.cloudflare?.status === "failed" || !row.cloudflare?.status || row.cloudflare.status === "not_added",
  );

  async function retryCloudflare() {
    const rows = cfTargets.length ? cfTargets : purchased;
    if (!rows.length) {
      toast.error("Select a domain first");
      return;
    }
    try {
      for (const row of rows) {
        const accountId = row.cloudflare?.account.id;
        if (!accountId) continue;
        await api(`/api/domains/${row.id}/cloudflare`, {
          method: "POST",
          body: JSON.stringify({ accountId }),
        });
      }
      toast.success("Cloudflare retry finished");
      queryClient.invalidateQueries({ queryKey: ["job", params.id] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Cloudflare retry failed");
      queryClient.invalidateQueries({ queryKey: ["job", params.id] });
    }
  }

  useEffect(() => {
    const node = logRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [logs.length]);

  const title =
    job?.status === "failed"
      ? "Purchase failed"
      : job?.status === "completed"
        ? `${done} domain${done === 1 ? "" : "s"} purchased${pendingRegistrations ? `, ${pendingRegistrations} awaiting registration` : ""}`
        : "Purchasing domains";

  return (
    <div>
      <PageHeader
        title={title}
        description={
          job?.status === "failed"
            ? job.error || "The purchase job failed. See the log below."
            : job
              ? `${job.progress?.completed ?? 0} / ${job.progress?.total ?? 0} completed`
              : "Starting..."
        }
        actions={
          <Button variant="outline" asChild>
            <Link href="/domains/purchase">Back to Purchase</Link>
          </Button>
        }
      />
      {payload && (
        <Card className="mb-4 grid gap-1 text-sm sm:grid-cols-3">
          <div>Registrar: {payload.registrarName ?? "—"}</div>
          <div>{payload.groupId ? "Group" : "Buyer"}: {payload.groupName ?? payload.buyerName ?? "—"}</div>
          <div>Cloudflare: {payload.cloudflareName ?? "—"}</div>
        </Card>
      )}
      {job?.status === "failed" && job.error && (
        <Card className="mb-4 border-destructive/40 text-sm text-destructive">{job.error}</Card>
      )}
      {domains.some((row) => row.cloudflare?.status === "failed") && (
        <Card className="mb-4 text-sm">
          Purchased domains are already registered. Resolve the Cloudflare error, then use Retry Cloudflare below to finish setup without purchasing again.
        </Card>
      )}
      {items.length > 0 && (
        <Card className="mb-4 space-y-2">
          {items.map((item) => {
            const savedDomain = item.domainId ? domainsById.get(item.domainId) : undefined;
            const error = savedDomain?.cloudflare
              ? savedDomain.cloudflare.status === "failed" ? savedDomain.cloudflare.errorMessage ?? item.error : undefined
              : item.error;
            return (
            <div key={item.domain} className="flex items-center justify-between gap-3 rounded-md px-2 py-1.5">
              <div className="min-w-0">
                <div className="font-medium">{item.domain}</div>
                {item.status === "purchasing" && item.step && (
                  <div className="text-xs text-muted-foreground">{item.step}</div>
                )}
                {error && <div className="text-sm text-destructive">{error}</div>}
              </div>
              <StatusBadge value={item.status} />
            </div>
            );
          })}
        </Card>
      )}
      <Card className="mb-4">
        <div className="mb-2 text-sm font-medium">
          Activity
          {job?.status !== "completed" && job?.status !== "failed" ? (
            <span className="ml-2 text-xs font-normal text-muted-foreground">live</span>
          ) : null}
        </div>
        <div ref={logRef} className="max-h-80 space-y-2 overflow-y-auto pr-1">
          {logs.map((log) => (
            <div key={log.id} className="flex gap-3 text-sm">
              <span className="w-36 shrink-0 text-muted-foreground">{formatDateTime(log.createdAt)}</span>
              <span
                className={cn(
                  log.level === "error" && "text-destructive",
                  log.level === "success" && "text-emerald-700 dark:text-emerald-400",
                  log.level === "warning" && "text-amber-700 dark:text-amber-400",
                )}
              >
                {log.message}
              </span>
            </div>
          ))}
          {!logs.length && (
            <div className="text-sm text-muted-foreground">
              {job ? "Waiting for the first log..." : "Starting purchase..."}
            </div>
          )}
        </div>
      </Card>
      {job?.status === "completed" && (
        <>
          <div className="mb-3 flex flex-wrap gap-2">
            <Button
              variant="outline"
              disabled={!domains.some((row) => row.cloudflare?.status === "failed")}
              onClick={retryCloudflare}
            >
              Retry Cloudflare
            </Button>
            <Button variant="outline" disabled={!selected.length} onClick={() => setModal("kt")}>
              Add to Keitaro
            </Button>
            <Button variant="outline" disabled={!selected.length} onClick={() => setModal("hs")}>
              Add to Hestia
            </Button>
          </div>
          <Table>
            <THead>
              <tr>
                <Th>
                  <input
                    type="checkbox"
                    checked={selected.length === domains.length && domains.length > 0}
                    onChange={(e) => setSelected(e.target.checked ? domains.map((row) => row.id) : [])}
                  />
                </Th>
                <Th>Domain</Th>
                <Th>Registrar</Th>
                <Th>Cloudflare</Th>
                <Th>DNS</Th>
                <Th>Server</Th>
              </tr>
            </THead>
            <tbody>
              {domains.map((row) => (
                <tr key={row.id} className="border-t">
                  <Td>
                    <input
                      type="checkbox"
                      checked={selected.includes(row.id)}
                      onChange={(e) =>
                        setSelected((curr) => (e.target.checked ? [...curr, row.id] : curr.filter((id) => id !== row.id)))
                      }
                    />
                  </Td>
                  <Td className="font-medium">
                    <Link className="underline-offset-2 hover:underline" href={`/domain/${encodeURIComponent(row.domain)}`}>
                      {row.domain}
                    </Link>
                  </Td>
                  <Td>✓</Td>
                  <Td>
                    {row.cloudflare ? <StatusBadge value={row.cloudflare.status} /> : "—"}
                  </Td>
                  <Td>{row.dns?.ip || "—"}</Td>
                  <Td>{row.server?.name || "—"}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <KeitaroAssignDialog
            open={modal === "kt"}
            onClose={() => setModal(null)}
            domainIds={selected}
            domains={purchased.map((row) => row.domain)}
            groupHint={purchased[0]?.group || purchased[0]?.buyer?.keitaroGroup || purchased[0]?.buyer?.stageName}
            onDone={() => queryClient.invalidateQueries({ queryKey: ["job", params.id] })}
          />
          <HestiaAssignDialog
            open={modal === "hs"}
            onClose={() => setModal(null)}
            domainIds={selected}
            domains={purchased.map((row) => row.domain)}
            onDone={() => queryClient.invalidateQueries({ queryKey: ["job", params.id] })}
          />
        </>
      )}
    </div>
  );
}
