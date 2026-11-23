"use client";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api/client";

export type DomainHttpsState = { configuredAt: string | null; error: string | null };
export function DomainHttps({ id, state, compact = false }: { id: string; state?: DomainHttpsState; compact?: boolean }) {
  const client = useQueryClient();
  const [busy, setBusy] = useState(false);
  if (state?.configuredAt && !state.error) return <p className="mt-1 text-xs text-muted-foreground" title="HTTP redirects to HTTPS through Cloudflare. Certificate issuance follows DNS activation.">HTTP → HTTPS configured</p>;
  if (compact) return state?.error ? <p className="mt-1 text-xs text-destructive">HTTPS needs attention</p> : <p className="mt-1 text-xs text-muted-foreground">HTTPS not configured</p>;
  return <div className="mt-2 max-w-xs space-y-1">
    {state?.error && <details className="text-xs text-destructive"><summary className="cursor-pointer">HTTPS needs attention</summary><p className="mt-1 whitespace-normal break-words">{state.error}</p></details>}
    <Button size="sm" variant="outline" disabled={busy} onClick={async () => {
      setBusy(true);
      try { await api(`/api/domains/${id}/https`, { method: "POST" }); toast.success("HTTPS redirect configured. DNS activation and certificate issuance may take time."); }
      catch (error) { toast.error(error instanceof Error ? error.message : "HTTPS setup failed"); }
      finally { setBusy(false); await Promise.all([client.invalidateQueries({ queryKey: ["domain"] }), client.invalidateQueries({ queryKey: ["domains"] }), client.invalidateQueries({ queryKey: ["job"] })]); }
    }}>{busy ? "Configuring…" : state?.error ? "Retry HTTPS" : "Enable HTTPS"}</Button>
  </div>;
}
