"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { GeneratorDialog } from "@/components/generator-dialog";
import { PageHeader } from "@/components/layout/app-shell";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card, Textarea } from "@/components/ui/primitives";
import { Field, Select } from "@/components/ui/dialog";
import { Table, THead, Th, Td } from "@/components/ui/table";
import { api } from "@/lib/api/client";
import { useCart } from "@/lib/cart";
import { DomainPriceLabel } from "@/components/domain-price";
import { formatMoney, parseDomainList, registrantLabel } from "@/lib/utils";

type Registrar = { id: string; name: string; provider: string };
type Buyer = { id: string; name: string; stageName?: string | null; keitaroGroup?: string | null; isDefault?: boolean; group?: { id: string; name: string } | null };
type CheckResult = {
  domain: string;
  available: boolean;
  price?: {
    registration: { amount: number; currency: string };
    listRegistration?: { amount: number; currency: string };
    promo?: boolean;
  };
};

export default function PurchasePage() {
  const router = useRouter();
  const { domains: cartDomains, registrarId: cartRegistrar, buyerId: cartBuyer, clear } = useCart();
  const { data: registrars } = useQuery({
    queryKey: ["registrars"],
    queryFn: () => api<{ registrars: Registrar[] }>("/api/registrars"),
  });
  const { data: buyers } = useQuery({
    queryKey: ["buyers"],
    queryFn: () => api<{ buyers: Buyer[] }>("/api/buyers"),
  });
  const { data: groups } = useQuery({
    queryKey: ["buyer-groups"],
    queryFn: () => api<{ groups: Array<{ id: string; name: string }> }>("/api/buyer-groups"),
  });
  const { data: settings } = useQuery({
    queryKey: ["settings"],
    queryFn: () =>
      api<{
        settings: {
          defaultRegistrarId?: string;
          defaultBuyerId?: string;
          defaultCloudflareId?: string;
        };
      }>("/api/settings"),
  });
  const { data: cf } = useQuery({
    queryKey: ["cloudflare"],
    queryFn: () => api<{ accounts: Array<{ id: string; name: string; domainCount: number }> }>("/api/cloudflare"),
  });
  const { data: registrants } = useQuery({
    queryKey: ["registrants"],
    queryFn: () =>
      api<{
        registrants: Array<{
          id: string;
          name: string;
          label: string;
          registrarId?: string | null;
          isDefault?: boolean;
          registrar?: { id: string; name: string } | null;
        }>;
      }>("/api/registrants"),
  });

  const [registrarId, setRegistrarId] = useState("");
  const [registrantId, setRegistrantId] = useState("");
  const [recipientType, setRecipientType] = useState<"buyer" | "group">("buyer");
  const [groupId, setGroupId] = useState("");
  const [buyerId, setBuyerId] = useState("");
  const [cloudflareId, setCloudflareId] = useState("");
  const [list, setList] = useState("");
  const [generatorOpen, setGeneratorOpen] = useState(false);
  const [checking, setChecking] = useState(false);
  const [loading, setLoading] = useState(false);
  const [checks, setChecks] = useState<CheckResult[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "available" | "unavailable" | "selected">("all");

  const accounts = registrars?.registrars ?? [];
  const parsed = useMemo(() => parseDomainList(list), [list]);
  const selectedBuyer = (buyers?.buyers ?? []).find((item) => item.id === buyerId);
  const selectedGroup = recipientType === "buyer" ? selectedBuyer?.group : groups?.groups.find((group) => group.id === groupId);
  const selectedRegistrar = accounts.find((item) => item.id === registrarId);
  const selectedCf = (cf?.accounts ?? []).find((item) => item.id === cloudflareId);
  const registrarRegistrants = (registrants?.registrants ?? []).filter(
    (item) => !item.registrarId || item.registrarId === registrarId,
  );
  const selectedRegistrant = registrarRegistrants.find((item) => item.id === registrantId);
  const hasRegistrant = registrarRegistrants.length > 0;

  useEffect(() => {
    if (cartDomains.length) setList(cartDomains.map((item) => item.domain).join("\n"));
  }, [cartDomains]);

  useEffect(() => {
    if (!accounts.length) return;
    const preferred =
      accounts.find((item) => item.id === (cartRegistrar || settings?.settings.defaultRegistrarId)) ?? accounts[0];
    setRegistrarId((curr) => curr || preferred.id);
  }, [accounts, cartRegistrar, settings]);

  useEffect(() => {
    const listBuyers = buyers?.buyers ?? [];
    if (!listBuyers.length) return;
    const preferred =
      listBuyers.find((item) => item.id === (cartBuyer || settings?.settings.defaultBuyerId)) ||
      listBuyers.find((item) => item.isDefault) ||
      listBuyers[0];
    setBuyerId((curr) => curr || preferred.id);
  }, [buyers, settings, cartBuyer]);

  useEffect(() => {
    const preferred = settings?.settings.defaultCloudflareId || cf?.accounts[0]?.id || "";
    setCloudflareId((curr) => curr || preferred);
  }, [settings, cf]);

  useEffect(() => {
    if (!registrarId) {
      setRegistrantId("");
      return;
    }
    const preferred =
      registrarRegistrants.find((item) => item.isDefault)?.id || registrarRegistrants[0]?.id || "";
    setRegistrantId((curr) => (registrarRegistrants.some((item) => item.id === curr) ? curr : preferred));
  }, [registrarId, registrants]);

  const { data: balance } = useQuery({
    queryKey: ["balance", registrarId],
    queryFn: () => api<{ balance: { amount: number; currency: string } }>(`/api/registrars/${registrarId}/balance`),
    enabled: Boolean(registrarId),
    retry: false,
  });

  const checkMap = new Map(checks.map((item) => [item.domain, item]));
  const buyable = parsed.filter((domain) => {
    const check = checkMap.get(domain);
    return selected.includes(domain) && (!check || check.available);
  });
  const total = buyable.reduce((sum, domain) => sum + (checkMap.get(domain)?.price?.registration.amount ?? 0), 0);
  const currency = buyable.map((domain) => checkMap.get(domain)?.price?.registration.currency).find(Boolean) ?? "USD";
  const visible = parsed.filter((domain) => {
    const check = checkMap.get(domain);
    const matchesQuery = !query || domain.includes(query.toLowerCase());
    if (!matchesQuery) return false;
    if (filter === "available") return check?.available;
    if (filter === "unavailable") return check && !check.available;
    if (filter === "selected") return selected.includes(domain);
    return true;
  });

  async function checkDomains() {
    if (!parsed.length) {
      toast.error("Enter domains first");
      return;
    }
    setChecking(true);
    try {
      const data = await api<{ results: CheckResult[] }>("/api/domains/check-bulk", {
        method: "POST",
        body: JSON.stringify({ domains: parsed, registrarId: registrarId || undefined }),
      });
      setChecks(data.results);
      setSelected(data.results.filter((item) => item.available).map((item) => item.domain));
      const taken = data.results.filter((item) => !item.available).length;
      if (taken) toast.message(`${taken} already taken`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Check failed");
    } finally {
      setChecking(false);
    }
  }

  async function purchase() {
    if (!cloudflareId) {
      toast.error("Select a Cloudflare account");
      return;
    }
    if (!registrantId) {
      toast.error("Select a registrant profile for this registrar");
      return;
    }
    setLoading(true);
    try {
      const result = await api<{ jobId: string }>("/api/domains/purchase", {
        method: "POST",
        body: JSON.stringify({
          domains: buyable.length ? buyable : parsed,
          registrarId,
          registrantId,
          buyerId: recipientType === "buyer" ? buyerId : null,
          groupId: recipientType === "group" ? groupId : null,
          cloudflareAccountId: cloudflareId,
        }),
      });
      clear();
      toast.success("Purchase started — watch the log");
      router.push(`/domains/jobs/${result.jobId}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Purchase failed");
    } finally {
      setLoading(false);
    }
  }

  function useGenerated(domains: string[]) {
    const next = [...parsed, ...domains.filter((domain) => !parsed.includes(domain))];
    setList(next.join("\n"));
    toast.success(`${domains.length} domains added`);
  }

  const count = buyable.length || parsed.length;

  return (
    <div>
      <PageHeader title="Buy Domains" description="Check, generate and purchase domains for a buyer/team." />
      <div className="grid gap-4 xl:grid-cols-[1fr_320px]">
        <div className="space-y-4">
          <Card className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Registrar">
              <Select value={registrarId} onChange={(e) => setRegistrarId(e.target.value)}>
                {accounts.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Registrant Profile">
              <Select value={registrantId} onChange={(e) => setRegistrantId(e.target.value)}>
                {!hasRegistrant && <option value="">No profile for this registrar</option>}
                {registrarRegistrants.map((item) => (
                  <option key={item.id} value={item.id}>
                    {registrantLabel(item)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Purchase for">
              <Select value={recipientType} onChange={(e) => setRecipientType(e.target.value as "buyer" | "group")}>
                <option value="buyer">Buyer</option>
                <option value="group">Group needs</option>
              </Select>
            </Field>
            {recipientType === "buyer" ? <Field label="Buyer">
              <Select value={buyerId} onChange={(e) => setBuyerId(e.target.value)}>
                <option value="">Select buyer</option>
                {(buyers?.buyers ?? []).map((item) => <option key={item.id} value={item.id}>{item.name}{item.group ? ` · ${item.group.name}` : ""}</option>)}
              </Select>
            </Field> : <Field label="Group">
              <Select value={groupId} onChange={(e) => setGroupId(e.target.value)}>
                <option value="">Select group</option>
                {(groups?.groups ?? []).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </Select>
            </Field>}
            <Field label="Cloudflare">
              <Select value={cloudflareId} onChange={(e) => setCloudflareId(e.target.value)}>
                {(cf?.accounts ?? []).map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} · {item.domainCount} domains
                  </option>
                ))}
              </Select>
            </Field>
          </Card>
          <Card>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm font-medium">Domains</div>
              <div className="flex gap-2">
                <Button variant="outline" onClick={checkDomains} disabled={checking}>
                  {checking ? "Checking..." : "Check Domains"}
                </Button>
                <Button onClick={() => setGeneratorOpen(true)}>Generate Domains</Button>
              </div>
            </div>
            <Textarea
              className="min-h-40"
              placeholder="Enter one domain per line..."
              value={list}
              onChange={(e) => setList(e.target.value)}
            />
          </Card>
          {parsed.length > 0 && (
            <Card className="space-y-3 p-0">
              <div className="flex flex-wrap items-center gap-2 p-3">
                <input
                  className="h-9 min-w-48 flex-1 rounded-md border bg-background px-3 text-sm"
                  placeholder="Search domains..."
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
                {(["all", "available", "unavailable", "selected"] as const).map((item) => (
                  <Button key={item} size="sm" variant={filter === item ? "default" : "outline"} onClick={() => setFilter(item)}>
                    {item[0].toUpperCase() + item.slice(1)}
                  </Button>
                ))}
              </div>
              <Table>
                <THead>
                  <tr>
                    <Th>
                      <input
                        type="checkbox"
                        checked={visible.filter((d) => checkMap.get(d)?.available !== false).every((d) => selected.includes(d)) && visible.length > 0}
                        onChange={(e) => {
                          const ids = visible.filter((d) => checkMap.get(d)?.available !== false);
                          setSelected(e.target.checked ? [...new Set([...selected, ...ids])] : selected.filter((id) => !ids.includes(id)));
                        }}
                      />
                    </Th>
                    <Th>Domain</Th>
                    <Th>Status</Th>
                    <Th>Price</Th>
                  </tr>
                </THead>
                <tbody>
                  {visible.map((domain) => {
                    const check = checkMap.get(domain);
                    const taken = check && !check.available;
                    return (
                      <tr key={domain} className="border-t">
                        <Td>
                          <input
                            type="checkbox"
                            disabled={Boolean(taken)}
                            checked={!taken && selected.includes(domain)}
                            onChange={(e) =>
                              setSelected((curr) => (e.target.checked ? [...curr, domain] : curr.filter((id) => id !== domain)))
                            }
                          />
                        </Td>
                        <Td className={taken ? "text-muted-foreground" : "font-medium"}>{domain}</Td>
                        <Td>
                          {check ? <StatusBadge value={check.available ? "available" : "unavailable"} /> : "—"}
                        </Td>
                        <Td>
                          {check?.price ? <DomainPriceLabel price={check.price} /> : taken ? "—" : "—"}
                        </Td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            </Card>
          )}
        </div>
        <Card className="h-fit space-y-2 text-sm">
          <div className="text-lg font-semibold">Purchase Summary</div>
          <div>Registrar: {selectedRegistrar?.name ?? "—"}</div>
          <div>Registrant: {selectedRegistrant ? registrantLabel(selectedRegistrant) : "—"}</div>
          {recipientType === "buyer" && <div>Buyer: {selectedBuyer?.name ?? "—"}</div>}
          <div>Group: {selectedGroup?.name ?? "—"}{recipientType === "group" ? " (group needs)" : ""}</div>
          <div>Cloudflare: {selectedCf ? `${selectedCf.name} · ${selectedCf.domainCount} domains` : "—"}</div>
          <div>Domains: {count}</div>
          <div>Total: {formatMoney(total, currency)}</div>
          <div>Registrar balance: {balance?.balance ? formatMoney(balance.balance.amount, balance.balance.currency) : "—"}</div>
          {balance?.balance && <div>After purchase: {formatMoney(balance.balance.amount - total, balance.balance.currency)}</div>}
          {!hasRegistrant && (
            <div className="rounded-md border border-amber-300/60 bg-amber-50 px-3 py-2 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
              Add a{" "}
              <Link className="underline" href="/settings/registrants">
                Registrant Profile
              </Link>{" "}
              before buying. That contact is sent to the registrar as WHOIS.
            </div>
          )}
          <Button
            className="mt-3 w-full"
            disabled={!parsed.length || !(recipientType === "buyer" ? buyerId : groupId) || !registrarId || !registrantId || !cloudflareId || loading}
            onClick={purchase}
          >
            {loading ? "Starting..." : `Buy ${count} Domain${count === 1 ? "" : "s"}`}
          </Button>
        </Card>
      </div>
      <GeneratorDialog
        open={generatorOpen}
        onClose={() => setGeneratorOpen(false)}
        registrarId={registrarId}
        onUse={useGenerated}
      />
    </div>
  );
}
