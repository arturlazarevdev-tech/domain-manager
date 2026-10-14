"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { Card, Input } from "@/components/ui/primitives";
import { Dialog, Field, Select } from "@/components/ui/dialog";
import { api } from "@/lib/api/client";

type UserRow = {
  id: string;
  email: string;
  name: string | null;
  role: "admin" | "tech";
  createdAt: string;
};

export default function UsersPage() {
  const queryClient = useQueryClient();
  const me = useQuery({
    queryKey: ["me"],
    queryFn: () => api<{ user: UserRow }>("/api/auth/me"),
  });
  const { data } = useQuery({
    queryKey: ["users"],
    queryFn: () => api<{ users: UserRow[] }>("/api/users"),
    enabled: Boolean(me.data?.user),
  });
  const [open, setOpen] = useState(false);
  const [resetId, setResetId] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [form, setForm] = useState({ name: "", email: "", password: "", role: "tech" });

  if (me.data?.user.role && me.data.user.role !== "admin") {
    return (
      <div>
        <PageHeader title="Users" />
        <Card>Only admins can add technicians.</Card>
      </div>
    );
  }

  async function save() {
    try {
      await api("/api/users", { method: "POST", body: JSON.stringify(form) });
      toast.success("User saved. They can sign in with this email and password.");
      setOpen(false);
      setForm({ name: "", email: "", password: "", role: "tech" });
      queryClient.invalidateQueries({ queryKey: ["users"] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Save failed");
    }
  }

  return (
    <div>
      <PageHeader
        title="Users"
        description="Technicians sign in here. Regway sees this server's IP, not each laptop."
        actions={<Button onClick={() => setOpen(true)}>Add technician</Button>}
      />
      <Card className="mb-4 text-sm text-muted-foreground">
        Keep one copy of the app running (this Mac or a VPS). Everyone opens the same URL. Whitelist that machine's
        public IP in Regway → Settings → API — not the techs' home IPs.
      </Card>
      <div className="grid gap-3">
        {(data?.users ?? []).map((user) => (
          <Card key={user.id} className="flex items-center justify-between gap-3">
            <div>
              <div className="font-medium">
                {user.name || user.email}{" "}
                <span className="text-xs uppercase text-muted-foreground">{user.role}</span>
              </div>
              <div className="text-sm text-muted-foreground">{user.email}</div>
            </div>
            {user.id !== me.data?.user.id && (
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => { setResetId(user.id); setNewPassword(""); }}>
                  Password
                </Button>
                <Button
                  variant="outline"
                  onClick={async () => {
                    try {
                      await api(`/api/users/${user.id}`, { method: "DELETE" });
                      queryClient.invalidateQueries({ queryKey: ["users"] });
                    } catch (error) {
                      toast.error(error instanceof Error ? error.message : "Delete failed");
                    }
                  }}
                >
                  Delete
                </Button>
              </div>
            )}
          </Card>
        ))}
      </div>
      <Dialog open={open} onClose={() => setOpen(false)} title="Add technician">
        <div className="grid gap-3">
          <Field label="Name">
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field label="Login (email)">
            <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </Field>
          <Field label="Password">
            <Input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          </Field>
          <Field label="Role">
            <Select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
              <option value="tech">Technician</option>
              <option value="admin">Admin</option>
            </Select>
          </Field>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={save} disabled={!form.email || form.password.length < 8}>
            Save
          </Button>
        </div>
      </Dialog>
      <Dialog open={Boolean(resetId)} onClose={() => setResetId(null)} title="Set password">
        <Field label="New password">
          <Input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
        </Field>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" onClick={() => setResetId(null)}>
            Cancel
          </Button>
          <Button
            disabled={newPassword.length < 8}
            onClick={async () => {
              if (!resetId) return;
              try {
                await api(`/api/users/${resetId}`, { method: "PATCH", body: JSON.stringify({ password: newPassword }) });
                toast.success("Password updated");
                setResetId(null);
              } catch (error) {
                toast.error(error instanceof Error ? error.message : "Update failed");
              }
            }}
          >
            Save
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
