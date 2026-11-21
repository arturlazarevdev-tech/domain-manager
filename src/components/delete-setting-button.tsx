"use client";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { api } from "@/lib/api/client";

export function DeleteSettingButton({ endpoint, name }: { endpoint: string; name: string }) {
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  return <>
    <Button variant="outline" size="sm" onClick={() => setOpen(true)}>Delete</Button>
    <Dialog open={open} onClose={() => { if (!busy) setOpen(false); }} title={`Delete ${name}?`}>
      <p className="text-sm">This entry will be removed from lists and future selections. Existing information in Purchased and purchase history will be preserved. Hosted websites and DNS records will stay in place.</p>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="outline" disabled={busy} onClick={() => setOpen(false)}>Cancel</Button>
        <Button disabled={busy} onClick={async () => {
          setBusy(true);
          try { await api(endpoint, { method: "DELETE" }); await client.invalidateQueries(); setOpen(false); toast.success("Deleted. Purchase history preserved."); }
          catch (error) { toast.error(error instanceof Error ? error.message : "Delete failed"); }
          finally { setBusy(false); }
        }}>{busy ? "Deleting…" : "Delete"}</Button>
      </div>
    </Dialog>
  </>;
}
