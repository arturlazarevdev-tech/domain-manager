"use client";

import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { LoaderCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api/client";

type RefreshScope = { domainId: string; domainIds?: never; all?: never } | { domainIds: string[]; domainId?: never; all?: never } | { all: true; domainId?: never; domainIds?: never };
type RefreshResult = { results?: Array<{ domain: string; ok: boolean; skipped?: boolean; error?: string }> };

export function RefreshDomainStatus({ domainId, domainIds, all, disabled = false, onBusyChange }: RefreshScope & { disabled?: boolean; onBusyChange?: (busy: boolean) => void }) {
  const client = useQueryClient();
  const running = useRef(false);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    if (running.current || disabled || (domainIds && !domainIds.length)) return;
    running.current = true;
    setBusy(true);
    onBusyChange?.(true);
    try {
      const result = await api<RefreshResult>(domainId ? `/api/domains/${domainId}/refresh` : "/api/domains/bulk/refresh", {
        method: "POST", ...(domainId ? {} : { body: JSON.stringify(all ? { all: true } : { domainIds }) }),
      });
      if (result.results) {
        const updated = result.results.filter(r => r.ok).length;
        const skipped = result.results.filter(r => r.skipped).length;
        const failed = result.results.filter(r => !r.ok && !r.skipped);
        const message = `${updated} refreshed${skipped ? `; ${skipped} skipped (not on Cloudflare)` : ""}${failed.length ? `; ${failed.length} failed` : ""}`;
        if (failed.length) toast.error(message, { description: failed.slice(0, 3).map(r => `${r.domain}: ${r.error}`).join("\n") });
        else if (skipped) toast.info(message);
        else toast.success(message);
      } else toast.success("Cloudflare statuses and DNS records updated");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Refresh failed");
    } finally {
      try {
        await Promise.all(["domain", "domains", "cloudflare"].map(key => client.invalidateQueries({ queryKey: [key] })));
      } finally {
        running.current = false;
        setBusy(false);
        onBusyChange?.(false);
      }
    }
  }

  return <div className="flex flex-col items-start gap-1">
    <Button variant="outline" disabled={busy || disabled || Boolean(domainIds && !domainIds.length)} aria-busy={busy} title={all ? "Refresh all domains connected to Cloudflare, including those hidden by filters" : undefined} onClick={refresh}>
      {busy && <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />}
      {busy ? "Refreshing…" : all ? "Refresh all" : domainIds ? `Refresh selected (${domainIds.length})` : "Refresh status"}
    </Button>
    <span role="status" className={busy ? "text-xs text-muted-foreground" : "sr-only"}>
      {busy ? "Updating Cloudflare status and DNS records…" : ""}
    </span>
  </div>;
}
