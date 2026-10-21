"use client";

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { toast } from "sonner";
import { DomainManagementDialog, TxtRecordDialog, type ManagedDomain } from "@/components/domain-management-dialogs";
import { HestiaAssignDialog, KeitaroAssignDialog } from "@/components/assign-server-dialogs";
import { PageHeader } from "@/components/layout/app-shell";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Table, THead, Th, Td } from "@/components/ui/table";
import { domainReportCsv, flattenReportGroups, groupDomainReport, matchesPurchaseDates, reportTotals, REPORT_GROUP_LABELS } from "@/lib/domain-report";
import { api } from "@/lib/api/client";
import { useReportGrouping } from "@/lib/report-preferences";
import { formatDate, formatMoney } from "@/lib/utils";

type DomainRow = {
  id: string;
  domain: string;
  purchasePrice: number;
  currency: string;
  purchasedAt?: string;
  status: string;
  registrar: { id: string; name: string };
  buyerGroup: { id: string; name: string } | null;
  buyer: { id: string; name: string; keitaroGroup?: string | null; stageName?: string | null } | null;
  cloudflare: { status: string; zoneId?: string | null; account: { id: string; name: string } } | null;
  keitaro?: ManagedDomain["keitaro"];
  hestia?: ManagedDomain["hestia"];
  dns: { ip: string | null };
  server: { type: string; name: string } | null;
  group: string | null;
};

export default function PurchasedPage() {
  const queryClient = useQueryClient();
  const { data, refetch } = useQuery({
    queryKey: ["domains"],
    queryFn: () => api<{ domains: DomainRow[] }>("/api/domains"),
  });
  const { data: buyers } = useQuery({
    queryKey: ["buyers"],
    queryFn: () => api<{ buyers: Array<{ id: string; name: string }> }>("/api/buyers"),
  });
  const { data: groups } = useQuery({
    queryKey: ["buyer-groups"],
    queryFn: () => api<{ groups: Array<{ id: string; name: string }> }>("/api/buyer-groups"),
  });
  const { data: cf } = useQuery({
    queryKey: ["cloudflare"],
    queryFn: () => api<{ accounts: Array<{ id: string; name: string; domainCount: number }> }>("/api/cloudflare"),
  });
  const [management, setManagement] = useState<DomainRow | "add" | null>(null);
  const [txtDomain, setTxtDomain] = useState<DomainRow | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [modal, setModal] = useState<"kt" | "hs" | null>(null);
  const [search, setSearch] = useState("");
  const [buyerFilter, setBuyerFilter] = useState("");
  const [groupFilter, setGroupFilter] = useState("");
  const [cfFilter, setCfFilter] = useState("");
  const [serverFilter, setServerFilter] = useState("");
  const [registrarFilter, setRegistrarFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [reportGrouping, setReportGrouping] = useReportGrouping();
  const invalidDates = Boolean(dateFrom && dateTo && dateFrom > dateTo);

  const domains = useMemo(() => {
    return (data?.domains ?? []).filter((row) => {
      if (!matchesPurchaseDates(row.purchasedAt, dateFrom, dateTo)) return false;
      if (search && !row.domain.includes(search.toLowerCase())) return false;
      if (buyerFilter && row.buyer?.id !== buyerFilter) return false;
      if (groupFilter && (groupFilter === "none" ? Boolean(row.buyerGroup) : row.buyerGroup?.id !== groupFilter)) return false;
      if (cfFilter && row.cloudflare?.account.name !== cfFilter) return false;
      if (serverFilter && row.server?.name !== serverFilter) return false;
      if (registrarFilter && row.registrar.name !== registrarFilter) return false;
      if (statusFilter && row.status !== statusFilter) return false;
      return true;
    });
  }, [data, search, buyerFilter, groupFilter, cfFilter, serverFilter, registrarFilter, statusFilter, dateFrom, dateTo]);

  const selectedRows = domains.filter((row) => selected.includes(row.id));
  const allSelected = domains.length > 0 && selectedRows.length === domains.length;
  const totals = useMemo(() => reportTotals(domains), [domains]);
  const reportGroups = useMemo(() => flattenReportGroups(groupDomainReport(domains, reportGrouping)), [domains, reportGrouping]);
  const groupHint = selectedRows[0]?.group || selectedRows[0]?.buyer?.keitaroGroup || selectedRows[0]?.buyer?.stageName;

  function exportReport() {
    if (invalidDates || !domains.length) return;
    const url = URL.createObjectURL(new Blob([domainReportCsv(domains, reportGrouping)], { type: "text/csv;charset=utf-8;" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `purchased-domains_${dateFrom || "all"}_${dateTo || "all"}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <div>
      <PageHeader
        title="Purchased domains"
        actions={
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => setManagement("add")}>+ Add domain</Button>
            <Button onClick={exportReport} disabled={invalidDates || !domains.length}>Export CSV</Button>
            <Button variant="outline" disabled={!selectedRows.length} onClick={() => setModal("kt")}>
              Add selected to Keitaro
            </Button>
            <Button variant="outline" disabled={!selectedRows.length} onClick={() => setModal("hs")}>
              Add selected to Hestia
            </Button>
            <Button
              variant="outline"
              onClick={async () => {
                try {
                  await api("/api/domains/bulk/refresh", { method: "POST" });
                  toast.success("Cloudflare statuses and DNS records updated");
                } catch (error) { toast.error(error instanceof Error ? error.message : "Refresh failed"); }
                finally {
                  refetch();
                  queryClient.invalidateQueries({ queryKey: ["domain"] });
                }
              }}
            >
              Refresh status
            </Button>
          </div>
        }
      />
      <div className="mb-3 flex flex-wrap gap-2">
        <input
          className="h-9 min-w-56 rounded-md border bg-background px-3 text-sm"
          placeholder="Search domain..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select className="h-9 rounded-md border bg-background px-2 text-sm" value={buyerFilter} onChange={(e) => setBuyerFilter(e.target.value)}>
          <option value="">Buyer</option>
          {(buyers?.buyers ?? []).map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
        <select aria-label="Filter by group" className="h-9 rounded-md border bg-background px-2 text-sm" value={groupFilter} onChange={(e) => setGroupFilter(e.target.value)}>
          <option value="">All groups</option>
          <option value="none">No group</option>
          {(groups?.groups ?? []).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
        <select className="h-9 rounded-md border bg-background px-2 text-sm" value={cfFilter} onChange={(e) => setCfFilter(e.target.value)}>
          <option value="">Cloudflare</option>
          {(cf?.accounts ?? []).map((item) => (
            <option key={item.id} value={item.name}>
              {item.name} · {item.domainCount} domains
            </option>
          ))}
        </select>
        <select className="h-9 rounded-md border bg-background px-2 text-sm" value={serverFilter} onChange={(e) => setServerFilter(e.target.value)}>
          <option value="">Server</option>
          {[...new Set((data?.domains ?? []).map((row) => row.server?.name).filter(Boolean))].map((name) => (
            <option key={name} value={name!}>
              {name}
            </option>
          ))}
        </select>
        <select className="h-9 rounded-md border bg-background px-2 text-sm" value={registrarFilter} onChange={(e) => setRegistrarFilter(e.target.value)}>
          <option value="">Registrar</option>
          {[...new Set((data?.domains ?? []).map((row) => row.registrar.name))].map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
        <select className="h-9 rounded-md border bg-background px-2 text-sm" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">Status</option>
          <option value="pending">Pending registration</option>
          <option value="purchased">Purchased</option>
          <option value="active">Active</option>
          <option value="failed">Failed</option>
        </select>
      </div>
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <label className="grid gap-1 text-sm">
          <span>Purchased from</span>
          <input type="date" className="h-9 rounded-md border bg-background px-2" value={dateFrom} max={dateTo || undefined} onChange={(e) => setDateFrom(e.target.value)} />
        </label>
        <label className="grid gap-1 text-sm">
          <span>Purchased to</span>
          <input type="date" className="h-9 rounded-md border bg-background px-2" value={dateTo} min={dateFrom || undefined} onChange={(e) => setDateTo(e.target.value)} />
        </label>
        {(dateFrom || dateTo) && <Button variant="outline" onClick={() => { setDateFrom(""); setDateTo(""); }}>Clear dates</Button>}
        <span className="pb-2 text-xs text-muted-foreground">Both dates are inclusive, in your local time.</span>
      </div>
      {invalidDates && <p role="alert" className="mb-3 text-sm text-destructive">The start date must be on or before the end date.</p>}
      <div className="mb-3 flex flex-wrap items-center gap-3 text-sm">
        <span className="font-medium">{domains.length} domains</span>
        {totals.map((total) => <span key={total.currency}>{formatMoney(total.amount, total.currency)}</span>)}
        <span className="text-xs text-muted-foreground">Report and export use the current filters. Totals are separate for each currency.</span>
      </div>
      <section className="mb-5 rounded-lg border bg-card p-4" aria-label="Spending report">
        <div className="mb-3 flex flex-wrap items-center gap-4 text-sm">
          <h2 className="font-semibold">Spending report</h2>
          <span className="text-muted-foreground">Group by:</span>
          {(["registrar", "buyerGroup", "buyer"] as const).map(dimension => (
            <label key={dimension} className="flex items-center gap-2">
              <input type="checkbox" checked={reportGrouping.includes(dimension)} onChange={e => setReportGrouping(
                (["registrar", "buyerGroup", "buyer"] as const).filter(key => key === dimension ? e.target.checked : reportGrouping.includes(key)),
              )} />
              {REPORT_GROUP_LABELS[dimension]}
            </label>
          ))}
        </div>
        {reportGroups.length > 0 && <Table>
          <THead><tr><Th>Group</Th><Th>Domains</Th><Th>Total spent</Th></tr></THead>
          <tbody>
            {reportGroups.map(group => <tr key={group.key} className="border-t">
              <Td style={{ paddingLeft: 12 + group.depth * 24 }}>
                <span className="text-xs text-muted-foreground">{REPORT_GROUP_LABELS[group.dimension]}: </span>
                <span className={group.children.length ? "font-semibold" : ""}>{group.label}</span>
              </Td>
              <Td>{group.domains.length}</Td>
              <Td>{group.totals.map(total => <div key={total.currency}>{formatMoney(total.amount, total.currency)}</div>)}</Td>
            </tr>)}
          </tbody>
        </Table>}
        <div className="mt-3 flex flex-wrap gap-3 text-sm font-semibold" aria-label="Report grand total">
          <span>Grand total: {domains.length} domains</span>
          {totals.map(total => <span key={total.currency}>{formatMoney(total.amount, total.currency)}</span>)}
        </div>
      </section>
      <Table>
        <THead>
          <tr>
            <Th>
              <input
                type="checkbox"
                checked={allSelected}
                onChange={(e) => setSelected(e.target.checked ? domains.map((d) => d.id) : [])}
              />
            </Th>
            <Th>Domain</Th>
            <Th>Registrar</Th>
            <Th>Buyer / Group needs</Th>
            <Th>Buyer group</Th>
            <Th>Price</Th>
            <Th>Cloudflare</Th>
            <Th>DNS</Th>
            <Th>Server</Th>
            <Th>Keitaro group</Th>
            <Th>Purchased</Th>
            <Th className="sticky right-0 bg-card">Actions</Th>
          </tr>
        </THead>
        <tbody>
          {!domains.length && <tr><Td colSpan={12} className="py-8 text-center text-muted-foreground">{data ? "No domains match these filters." : "Loading domains..."}</Td></tr>}
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
              <Td>
                <Link className="font-medium hover:underline" href={`/domain/${row.domain}`}>
                  {row.domain}
                </Link>
              </Td>
              <Td>{row.registrar.name}</Td>
              <Td>
                <select
                  className="h-8 max-w-36 rounded-md border bg-background px-2 text-sm"
                  aria-label={`Assign ${row.domain}`}
                  value={row.buyer ? `buyer:${row.buyer.id}` : row.buyerGroup ? `group:${row.buyerGroup.id}` : ""}
                  onChange={async (e) => {
                    const [type, recipientId] = e.target.value.split(":");
                    if (!recipientId) return;
                    try {
                      await api(`/api/domains/${row.id}`, {
                        method: "PATCH",
                        body: JSON.stringify(type === "group" ? { groupId: recipientId } : { buyerId: recipientId }),
                      });
                      toast.success("Assignment updated");
                      for (const key of ["buyers", "buyer-groups", "dashboard"]) queryClient.invalidateQueries({ queryKey: [key] });
                      queryClient.invalidateQueries({ queryKey: ["domains"] });
                    } catch (error) {
                      toast.error(error instanceof Error ? error.message : "Could not change buyer");
                    }
                  }}
                >
                  {!row.buyer && !row.buyerGroup && <option value="">—</option>}
                  <optgroup label="Buyers">
                  {(buyers?.buyers ?? []).map((item) => (
                    <option key={item.id} value={`buyer:${item.id}`}>
                      {item.name}
                    </option>
                  ))}
                  </optgroup>
                  <optgroup label="Group needs">
                    {(groups?.groups ?? []).map((item) => <option key={item.id} value={`group:${item.id}`}>{item.name} (group needs)</option>)}
                  </optgroup>
                </select>
              </Td>
              <Td>{row.buyerGroup?.name ?? "—"}</Td>
              <Td>{formatMoney(row.purchasePrice, row.currency)}</Td>
              <Td>
                {row.cloudflare ? (
                  <span>
                    {row.cloudflare.account.name} <StatusBadge value={row.cloudflare.status} />
                  </span>
                ) : (
                  "—"
                )}
              </Td>
              <Td>{row.dns?.ip || "—"}</Td>
              <Td>{row.server ? row.server.name : "—"}</Td>
              <Td>{row.group || "—"}</Td>
              <Td>{formatDate(row.purchasedAt)}</Td>
              <Td className="sticky right-0 bg-card"><div className="flex gap-2"><Button variant="outline" size="sm" onClick={() => setManagement(row)}>Update</Button><Button variant="outline" size="sm" disabled={!row.cloudflare?.zoneId} onClick={() => setTxtDomain(row)}>Add TXT</Button></div></Td>
            </tr>
          ))}
        </tbody>
      </Table>
      {management && <DomainManagementDialog domain={management === "add" ? undefined : management} onClose={() => setManagement(null)} />}
      {txtDomain && <TxtRecordDialog domain={txtDomain} onClose={() => setTxtDomain(null)} />}
      <KeitaroAssignDialog
        open={modal === "kt"}
        onClose={() => setModal(null)}
        domainIds={selectedRows.map((row) => row.id)}
        domains={selectedRows.map((row) => row.domain)}
        groupHint={groupHint}
        onDone={() => {
          setSelected([]);
          refetch();
        }}
      />
      <HestiaAssignDialog
        open={modal === "hs"}
        onClose={() => setModal(null)}
        domainIds={selectedRows.map((row) => row.id)}
        domains={selectedRows.map((row) => row.domain)}
        onDone={() => {
          setSelected([]);
          refetch();
        }}
      />
    </div>
  );
}
