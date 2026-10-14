"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { Card, Input } from "@/components/ui/primitives";
import { Dialog, Field, Select } from "@/components/ui/dialog";
import { registrantLabel } from "@/lib/utils";
import { api } from "@/lib/api/client";

type Profile = {
  id: string;
  name: string;
  label: string;
  company?: string | null;
  email: string;
  phone: string;
  phoneCc: string;
  phoneAreaCode: string;
  country: string;
  state: string;
  city: string;
  address: string;
  zip: string;
  isDefault: boolean;
  registrarId?: string | null;
  registrar?: { id: string; name: string } | null;
};

const empty = {
  label: "",
  name: "",
  company: "",
  email: "",
  phone: "",
  phoneCc: "1",
  phoneAreaCode: "",
  country: "US",
  state: "",
  city: "",
  address: "",
  zip: "",
  registrarId: "",
};

export default function RegistrantsPage() {
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey: ["registrants"],
    queryFn: () => api<{ registrants: Profile[] }>("/api/registrants"),
  });
  const { data: registrars } = useQuery({
    queryKey: ["registrars"],
    queryFn: () => api<{ registrars: Array<{ id: string; name: string }> }>("/api/registrars"),
  });
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(empty);

  async function save() {
    try {
      if (editingId) {
        await api(`/api/registrants/${editingId}`, { method: "PATCH", body: JSON.stringify(form) });
      } else {
        await api("/api/registrants", {
          method: "POST",
          body: JSON.stringify({
            ...form,
            isDefault: !(data?.registrants ?? []).some((item) => item.registrarId === form.registrarId),
          }),
        });
      }
      toast.success("Registrant saved");
      setOpen(false);
      queryClient.invalidateQueries({ queryKey: ["registrants"] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Save failed");
    }
  }

  return (
    <div>
      <PageHeader
        title="Registrant Profiles"
        description="WHOIS contact for a specific registrar. On Purchase pick Registrar and its profile."
        actions={
          <Button
            onClick={() => {
              setEditingId(null);
              setForm({ ...empty, registrarId: registrars?.registrars[0]?.id ?? "" });
              setOpen(true);
            }}
          >
            Add
          </Button>
        }
      />
      <div className="grid gap-3">
        {(data?.registrants ?? []).map((item) => (
          <Card key={item.id} className="flex items-center justify-between gap-3">
            <div>
              <div className="font-medium">
                {registrantLabel(item)} {item.isDefault && <span className="text-xs text-primary">Default</span>}
              </div>
              <div className="text-sm text-muted-foreground">
                {item.registrar?.name ?? "No registrar"} · {item.email} · {item.country} · {item.city}
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setEditingId(item.id);
                  setForm({
                    name: item.name,
                    label: item.label ?? "",
                    company: item.company ?? "",
                    email: item.email,
                    phone: item.phone,
                    phoneCc: item.phoneCc,
                    phoneAreaCode: item.phoneAreaCode ?? "",
                    country: item.country,
                    state: item.state,
                    city: item.city,
                    address: item.address,
                    zip: item.zip,
                    registrarId: item.registrarId ?? item.registrar?.id ?? "",
                  });
                  setOpen(true);
                }}
              >
                Edit
              </Button>
              <Button
                variant="outline"
                onClick={async () => {
                  await api(`/api/registrants/${item.id}`, { method: "PATCH", body: JSON.stringify({ isDefault: true }) });
                  queryClient.invalidateQueries({ queryKey: ["registrants"] });
                }}
              >
                Set default
              </Button>
              <Button
                variant="outline"
                onClick={async () => {
                  await api(`/api/registrants/${item.id}`, { method: "DELETE" });
                  queryClient.invalidateQueries({ queryKey: ["registrants"] });
                }}
              >
                Delete
              </Button>
            </div>
          </Card>
        ))}
      </div>
      <Dialog open={open} onClose={() => setOpen(false)} title={editingId ? "Edit registrant" : "Add registrant"}>
        <div className="grid gap-3">
          <Field label="Registrar">
            <Select value={form.registrarId} onChange={(e) => setForm({ ...form, registrarId: e.target.value })}>
              {(registrars?.registrars ?? []).map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Display label (optional)">
            <Input value={form.label} maxLength={100} placeholder="for Regway" onChange={(e) => setForm({ ...form, label: e.target.value })} />
            <span className="text-xs text-muted-foreground">Shown beside the contact name when selecting a profile.</span>
          </Field>
          <p className="text-xs text-muted-foreground">For Openprovider use first and last name, include the house number in Address, and fill Phone area code. Phone contains the subscriber number.</p>
          {Object.entries({
            name: "Name",
            company: "Company",
            email: "Email",
            phone: "Phone",
            phoneCc: "Phone country code",
            phoneAreaCode: "Phone area code (required for Openprovider)",
            country: "Country",
            state: "State",
            city: "City",
            address: "Address",
            zip: "ZIP",
          }).map(([key, label]) => (
            <Field key={key} label={label}>
              <Input
                value={form[key as keyof typeof form]}
                onChange={(e) => setForm({ ...form, [key]: e.target.value })}
              />
            </Field>
          ))}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={save}>Save</Button>
        </div>
      </Dialog>
    </div>
  );
}
