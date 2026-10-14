"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, Field, Select } from "@/components/ui/dialog";
import { api } from "@/lib/api/client";

type Server = { id: string; name: string; ipAddress?: string | null; username?: string };

export function KeitaroAssignDialog({
  open,
  onClose,
  domainIds,
  domains,
  groupHint,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  domainIds: string[];
  domains?: string[];
  groupHint?: string | null;
  onDone?: () => void;
}) {
  const { data } = useQuery({
    queryKey: ["keitaro"],
    queryFn: () => api<{ servers: Server[] }>("/api/keitaro"),
    enabled: open,
  });
  const { data: buyers } = useQuery({
    queryKey: ["buyers"],
    queryFn: () => api<{ buyers: Array<{ id: string; name: string }> }>("/api/buyers"),
    enabled: open,
  });
  const [serverId, setServerId] = useState("");
  const [buyerId, setBuyerId] = useState("");
  const [loading, setLoading] = useState(false);
  const server = (data?.servers ?? []).find((item) => item.id === serverId);
  const buyerList = buyers?.buyers ?? [];
  const selectedBuyer = buyerList.find((item) => item.id === buyerId);
  const group = selectedBuyer?.name ?? "";

  useEffect(() => {
    if (open && !serverId && data?.servers[0]) setServerId(data.servers[0].id);
  }, [open, data, serverId]);

  useEffect(() => {
    if (!open) return;
    const match = buyerList.find(
      (item) => item.name.toLowerCase() === (groupHint ?? "").toLowerCase(),
    );
    setBuyerId(match?.id || buyerList[0]?.id || "");
  }, [open, groupHint, buyers]);

  async function submit() {
    setLoading(true);
    try {
      const path = domainIds.length === 1 ? `/api/domains/${domainIds[0]}/keitaro` : "/api/domains/bulk/keitaro";
      const body =
        domainIds.length === 1
          ? { serverId, group: group || null }
          : { domainIds, serverId, group: group || null };
      await api(path, { method: "POST", body: JSON.stringify(body) });
      toast.success(domainIds.length === 1 ? "Added to Keitaro" : `${domainIds.length} domains added to Keitaro`);
      onClose();
      onDone?.();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Keitaro failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title="Add domain to Keitaro">
      <div className="grid gap-3 text-sm">
        {domains?.length === 1 && (
          <div>
            <div className="text-muted-foreground">Domain</div>
            <div className="font-medium">{domains[0]}</div>
          </div>
        )}
        <Field label="Keitaro server">
          <Select value={serverId} onChange={(e) => setServerId(e.target.value)}>
            {(data?.servers ?? []).map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Buyer group">
          <Select value={buyerId} onChange={(e) => setBuyerId(e.target.value)}>
            {!buyerList.length && <option value="">No buyers</option>}
            {buyerList.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </Select>
        </Field>
        <div>
          <div className="text-muted-foreground">IP</div>
          <div className="font-medium">{server?.ipAddress || "Set IP in Settings → Servers"}</div>
        </div>
        {domainIds.length > 1 && (
          <div>
            <div className="text-muted-foreground">Domains</div>
            <div className="font-medium">{domainIds.length}</div>
          </div>
        )}
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button disabled={!serverId || loading} onClick={submit}>
          {loading ? "Adding..." : domainIds.length > 1 ? `Add ${domainIds.length} Domains` : "Add"}
        </Button>
      </div>
    </Dialog>
  );
}

export function HestiaAssignDialog({
  open,
  onClose,
  domainIds,
  domains,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  domainIds: string[];
  domains?: string[];
  onDone?: () => void;
}) {
  const { data } = useQuery({
    queryKey: ["hestia"],
    queryFn: () => api<{ servers: Server[] }>("/api/hestia"),
    enabled: open,
  });
  const [serverId, setServerId] = useState("");
  const [loading, setLoading] = useState(false);
  const server = (data?.servers ?? []).find((item) => item.id === serverId);

  useEffect(() => {
    if (open && !serverId && data?.servers[0]) setServerId(data.servers[0].id);
  }, [open, data, serverId]);

  async function submit() {
    setLoading(true);
    try {
      const path = domainIds.length === 1 ? `/api/domains/${domainIds[0]}/hestia` : "/api/domains/bulk/hestia";
      const body =
        domainIds.length === 1
          ? { serverId, webUser: server?.username }
          : { domainIds, serverId, webUser: server?.username };
      await api(path, { method: "POST", body: JSON.stringify(body) });
      toast.success(domainIds.length === 1 ? "Added to Hestia" : `${domainIds.length} domains added to Hestia`);
      onClose();
      onDone?.();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Hestia failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title="Add domain to Hestia">
      <div className="grid gap-3 text-sm">
        {domains?.length === 1 && (
          <div>
            <div className="text-muted-foreground">Domain</div>
            <div className="font-medium">{domains[0]}</div>
          </div>
        )}
        <Field label="Hestia server">
          <Select value={serverId} onChange={(e) => setServerId(e.target.value)}>
            {(data?.servers ?? []).map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </Select>
        </Field>
        <div>
          <div className="text-muted-foreground">IP</div>
          <div className="font-medium">{server?.ipAddress || "Set IP in Settings → Servers"}</div>
        </div>
        {domainIds.length > 1 && (
          <div>
            <div className="text-muted-foreground">Domains</div>
            <div className="font-medium">{domainIds.length}</div>
          </div>
        )}
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button disabled={!serverId || loading} onClick={submit}>
          {loading ? "Adding..." : domainIds.length > 1 ? `Add ${domainIds.length} Domains` : "Add"}
        </Button>
      </div>
    </Dialog>
  );
}
