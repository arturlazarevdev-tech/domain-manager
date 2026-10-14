"use client";

import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/layout/app-shell";
import { StatusBadge } from "@/components/status-badge";
import { Card } from "@/components/ui/primitives";
import { api } from "@/lib/api/client";

export default function KeitaroInfraPage() {
  const { data } = useQuery({
    queryKey: ["keitaro"],
    queryFn: () =>
      api<{ servers: Array<{ id: string; name: string; url: string; ipAddress?: string | null; connectionStatus: string; domainCount: number }> }>(
        "/api/keitaro",
      ),
  });
  return (
    <div>
      <PageHeader title="Keitaro" />
      <div className="grid gap-3 md:grid-cols-2">
        {(data?.servers ?? []).map((item) => (
          <Card key={item.id}>
            <div className="font-medium">{item.name}</div>
            <div className="mt-1 text-xs text-muted-foreground">{item.url}</div>
            <div className="mt-1 text-sm">IP {item.ipAddress || "—"}</div>
            <div className="mt-3 flex justify-between text-sm">
              <StatusBadge value={item.connectionStatus} />
              <span>{item.domainCount} domains</span>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
