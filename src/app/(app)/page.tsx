"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { PageHeader } from "@/components/layout/app-shell";
import { StatusBadge } from "@/components/status-badge";
import { Card } from "@/components/ui/primitives";
import { Table, THead, Th, Td } from "@/components/ui/table";
import { SpendTotals } from "@/components/spend-totals";
import type { SpendTotal } from "@/lib/services/spending";
import { useSelectedRegistrar } from "@/lib/hooks/use-selected-registrar";
import { api } from "@/lib/api/client";
import { formatDate, formatMoney } from "@/lib/utils";

type Dashboard = {
  domains: number;
  cloudflare: number;
  keitaro: number;
  hestia: number;
  spendByBuyer: Array<{
    id: string;
    name: string;
    stageName?: string | null;
    group: { id: string; name: string } | null;
    totals: SpendTotal[];
    domainCount: number;
    spend: number;
    spendThisMonth: number;
  }>;
  spendByGroup: Array<{ id: string; name: string; buyerCount: number; domainCount: number; totals: SpendTotal[] }>;
  recent: Array<{
    id: string;
    domain: string;
    registrar: string;
    price: number;
    currency: string;
    buyer: string;
    buyerGroup: string;
    cloudflare: string;
    server: string;
    status: string;
    purchasedAt: string;
  }>;
};

export default function DashboardPage() {
  const { registrar, registrars, balance } = useSelectedRegistrar();
  const { data } = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => api<Dashboard>("/api/dashboard"),
  });

  const cards = [
    { label: "Registrar", value: registrar?.name ?? (registrars.isPending ? "Loading..." : "Not configured") },
    { label: "Balance", value: balance.data?.balance ? formatMoney(balance.data.balance.amount, balance.data.balance.currency) : "—" },
    { label: "Domains", value: data?.domains ?? 0 },
    { label: "Cloudflare", value: `${data?.cloudflare ?? 0} accounts` },
    { label: "Keitaro", value: `${data?.keitaro ?? 0} servers` },
    { label: "Hestia", value: `${data?.hestia ?? 0} servers` },
  ];

  return (
    <div>
      <PageHeader title="Dashboard" description="Overview of registrars, inventory and infrastructure." />
      <div className="mb-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {cards.map((card) => (
          <Card key={card.label}>
            <div className="text-sm text-muted-foreground">{card.label}</div>
            <div className="mt-2 text-2xl font-semibold">{card.value}</div>
          </Card>
        ))}
      </div>
      <h2 className="mb-3 text-lg font-semibold">Spend by group</h2>
      <div className="mb-8 grid gap-3 md:grid-cols-3">
        {(data?.spendByGroup ?? []).map((group) => <Card key={group.id}>
          <div className="font-medium">{group.name}</div>
          <div className="mt-1 text-sm text-muted-foreground">{group.buyerCount} buyers · {group.domainCount} domains</div>
          <SpendTotals totals={group.totals} />
        </Card>)}
        {!data?.spendByGroup?.length && <Card className="text-sm text-muted-foreground">No groups yet.</Card>}
      </div>
      <h2 className="mb-3 text-lg font-semibold">Spend by buyer</h2>
      <div className="mb-8 grid gap-3 md:grid-cols-3">
        {(data?.spendByBuyer ?? []).map((item) => (
          <Card key={item.id}>
            <div className="font-medium">{item.name}</div>
            <div className="text-sm text-muted-foreground">{item.group?.name ?? "No group"}</div>
            <div className="mt-1 text-sm text-muted-foreground">{item.domainCount} domains</div>
            <SpendTotals totals={item.totals} />
          </Card>
        ))}
        {!data?.spendByBuyer?.length && (
          <Card className="text-sm text-muted-foreground">No buyer spend yet.</Card>
        )}
      </div>
      <h2 className="mb-3 text-lg font-semibold">Recent purchases</h2>
      <Table>
        <THead>
          <tr>
            <Th>Domain</Th>
            <Th>Registrar</Th>
            <Th>Price</Th>
            <Th>Buyer</Th>
            <Th>Group</Th>
            <Th>Cloudflare</Th>
            <Th>Server</Th>
            <Th>Status</Th>
            <Th>Purchased at</Th>
          </tr>
        </THead>
        <tbody>
          {(data?.recent ?? []).map((row) => (
            <tr key={row.id} className="border-t">
              <Td>
                <Link className="font-medium hover:underline" href={`/domain/${row.domain}`}>
                  {row.domain}
                </Link>
              </Td>
              <Td>{row.registrar}</Td>
              <Td>{formatMoney(row.price, row.currency)}</Td>
              <Td>{row.buyer}</Td>
              <Td>{row.buyerGroup}</Td>
              <Td>{row.cloudflare}</Td>
              <Td>{row.server}</Td>
              <Td>
                <StatusBadge value={row.status} />
              </Td>
              <Td>{formatDate(row.purchasedAt)}</Td>
            </tr>
          ))}
          {!data?.recent.length && (
            <tr>
              <Td colSpan={9} className="py-8 text-center text-muted-foreground">
                No purchases yet.
              </Td>
            </tr>
          )}
        </tbody>
      </Table>
    </div>
  );
}
