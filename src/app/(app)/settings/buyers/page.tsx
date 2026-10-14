"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/primitives";
import { Dialog, Field } from "@/components/ui/dialog";
import { Table, THead, Th, Td } from "@/components/ui/table";
import { api } from "@/lib/api/client";
import { SpendTotals } from "@/components/spend-totals";
import type { SpendTotal } from "@/lib/services/spending";
import { Select } from "@/components/ui/dialog";

type Buyer = {
  id: string;
  name: string;
  domainCount: number;
  spend: number;
  spendThisMonth: number;
  currency: string;
  groupId: string | null;
  group: { id: string; name: string } | null;
  totals: SpendTotal[];
};

type Group = { id: string; name: string; buyerCount: number; domainCount: number; totals: SpendTotal[] };

export default function BuyersPage() {
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey: ["buyers"],
    queryFn: () => api<{ buyers: Buyer[] }>("/api/buyers"),
  });
  const { data: groups } = useQuery({
    queryKey: ["buyer-groups"],
    queryFn: () => api<{ groups: Group[] }>("/api/buyer-groups"),
  });
  const [groupId, setGroupId] = useState("");
  const [groupOpen, setGroupOpen] = useState(false);
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [groupName, setGroupName] = useState("");
  function refresh() {
    for (const key of ["buyers", "buyer-groups", "dashboard", "domains"]) {
      queryClient.invalidateQueries({ queryKey: [key] });
    }
  }
  async function saveGroup() {
    try {
      await api(editingGroupId ? `/api/buyer-groups/${editingGroupId}` : "/api/buyer-groups", {
        method: editingGroupId ? "PATCH" : "POST", body: JSON.stringify({ name: groupName.trim() }),
      });
      setGroupOpen(false);
      refresh();
      toast.success("Group saved");
    } catch (error) { toast.error(error instanceof Error ? error.message : "Save failed"); }
  }
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");

  async function save() {
    try {
      const payload = { name: name.trim(), groupId: groupId || null };
      if (editingId) {
        await api(`/api/buyers/${editingId}`, { method: "PATCH", body: JSON.stringify(payload) });
      } else {
        await api("/api/buyers", { method: "POST", body: JSON.stringify(payload) });
      }
      toast.success("Buyer saved");
      setOpen(false);
      setEditingId(null);
      setName("");
      refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Save failed");
    }
  }

  return (
    <div>
      <PageHeader
        title="Buyers"
        description="Assign buyers to groups. Group spend includes buyer purchases and purchases made directly for the group."
        actions={
          <div className="flex gap-2">
          <Button variant="outline" onClick={() => { setEditingGroupId(null); setGroupName(""); setGroupOpen(true); }}>+ Add Group</Button>
          <Button
            onClick={() => {
              setEditingId(null);
              setName("");
              setGroupId("");
              setOpen(true);
            }}
          >
            + Add Buyer
          </Button>
          </div>
        }
      />
      <h2 className="mb-3 text-lg font-semibold">Groups</h2>
      <div className="mb-8 grid gap-3 md:grid-cols-3">
        {(groups?.groups ?? []).map((group) => <div key={group.id} className="rounded-lg border p-4">
          <div className="flex items-center justify-between gap-2"><span className="font-semibold">{group.name}</span>
            <Button variant="outline" size="sm" onClick={() => { setEditingGroupId(group.id); setGroupName(group.name); setGroupOpen(true); }}>Edit</Button>
          </div>
          <div className="text-sm text-muted-foreground">{group.buyerCount} buyers · {group.domainCount} domains</div>
          <SpendTotals totals={group.totals} />
        </div>)}
        {!groups?.groups.length && <div className="text-sm text-muted-foreground">Add a group, then assign buyers to it.</div>}
      </div>
      <h2 className="mb-3 text-lg font-semibold">Buyers</h2>
      <Table>
        <THead>
          <tr>
            <Th>Buyer</Th>
            <Th>Group</Th>
            <Th>Domains</Th>
            <Th>Spend</Th>
            <Th></Th>
          </tr>
        </THead>
        <tbody>
          {(data?.buyers ?? []).map((buyer) => (
            <tr key={buyer.id} className="border-t">
              <Td className="font-medium">{buyer.name}</Td>
              <Td>{buyer.group?.name ?? "—"}</Td>
              <Td>{buyer.domainCount}</Td>
              <Td>
                <SpendTotals totals={buyer.totals} />
              </Td>
              <Td>
                <div className="flex justify-end gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setEditingId(buyer.id);
                      setName(buyer.name);
                      setGroupId(buyer.groupId ?? "");
                      setOpen(true);
                    }}
                  >
                    Edit
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={async () => {
                      await api(`/api/buyers/${buyer.id}`, { method: "DELETE" });
                      refresh();
                    }}
                  >
                    Delete
                  </Button>
                </div>
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
      <Dialog open={open} onClose={() => setOpen(false)} title={editingId ? "Edit Buyer" : "Add Buyer"}>
        <Field label="Buyer">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="KIT" />
        </Field>
        <Field label="Group">
          <Select value={groupId} onChange={(e) => setGroupId(e.target.value)}>
            <option value="">No group</option>
            {(groups?.groups ?? []).map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
          </Select>
        </Field>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={save} disabled={!name.trim()}>
            Save
          </Button>
        </div>
      </Dialog>
      <Dialog open={groupOpen} onClose={() => setGroupOpen(false)} title={editingGroupId ? "Edit Group" : "Add Group"}>
        <Field label="Group name"><Input value={groupName} onChange={(e) => setGroupName(e.target.value)} placeholder="KIT TEAM" /></Field>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" onClick={() => setGroupOpen(false)}>Cancel</Button>
          <Button onClick={saveGroup} disabled={!groupName.trim()}>Save</Button>
        </div>
      </Dialog>
    </div>
  );
}
