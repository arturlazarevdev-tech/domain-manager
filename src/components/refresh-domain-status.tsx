"use client";

import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { LoaderCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api/client";

export function RefreshDomainStatus({ domainId }: { domainId?: string }) {
  const client = useQueryClient();
  const running = useRef(false);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    try {
      await api(domainId ? `/api/domains/${domainId}/refresh` : "/api/domains/bulk/refresh", { method: "POST" });
      toast.success("Cloudflare statuses and DNS records updated");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Refresh failed");
    } finally {
      try {
        await Promise.all(["domain", "domains", "cloudflare"].map(key => client.invalidateQueries({ queryKey: [key] })));
      } finally {
        running.current = false;
        setBusy(false);
      }
    }
  }

  return <div className="flex flex-col items-start gap-1">
    <Button variant="outline" disabled={busy} aria-busy={busy} onClick={refresh}>
      {busy && <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />}
      {busy ? "Refreshing…" : "Refresh status"}
    </Button>
    <span role="status" className={busy ? "text-xs text-muted-foreground" : "sr-only"}>
      {busy ? "Updating Cloudflare status and DNS records…" : ""}
    </span>
  </div>;
}
