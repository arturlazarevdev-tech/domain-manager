"use client";

import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/layout/app-shell";
import { StatusBadge } from "@/components/status-badge";
import { Card } from "@/components/ui/primitives";
import { api } from "@/lib/api/client";

type Infra = {
  accounts?: Array<{ id: string; name: string; connectionStatus: string; domainCount: number }>;
  servers?: Array<{ id: string; name: string; connectionStatus: string; domainCount: number }>;
};

export default function InfrastructurePage() {
  const cf = useQuery({ queryKey: ["cloudflare"], queryFn: () => api<Infra>("/api/cloudflare") });
  const kt = useQuery({ queryKey: ["keitaro"], queryFn: () => api<Infra>("/api/keitaro") });
  const hs = useQuery({ queryKey: ["hestia"], queryFn: () => api<Infra>("/api/hestia") });

  return (
    <div>
      <PageHeader title="Infrastructure" />
      <Section title="Cloudflare" items={cf.data?.accounts ?? []} />
      <Section title="Keitaro" items={kt.data?.servers ?? []} />
      <Section title="Hestia" items={hs.data?.servers ?? []} />
    </div>
  );
}

function Section({
  title,
  items,
}: {
  title: string;
  items: Array<{ id: string; name: string; connectionStatus: string; domainCount: number }>;
}) {
  return (
    <div className="mb-8">
      <h2 className="mb-3 text-lg font-semibold">{title}</h2>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {items.map((item) => (
          <Card key={item.id}>
            <div className="font-medium">{item.name}</div>
            <div className="mt-2 flex items-center justify-between text-sm">
              <StatusBadge value={item.connectionStatus} />
              <span className="text-muted-foreground">{item.domainCount} domains</span>
            </div>
          </Card>
        ))}
        {!items.length && <Card className="text-sm text-muted-foreground">Nothing configured yet.</Card>}
      </div>
    </div>
  );
}
