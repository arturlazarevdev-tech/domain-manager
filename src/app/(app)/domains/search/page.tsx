"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/app-shell";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card, Input, Textarea } from "@/components/ui/primitives";
import { Select } from "@/components/ui/dialog";
import { api } from "@/lib/api/client";
import { useCart } from "@/lib/cart";
import { DomainPriceLabel } from "@/components/domain-price";
import { formatMoney, parseDomainList } from "@/lib/utils";

type CheckResult = {
  domain: string;
  available: boolean;
  reason?: string;
  registrar?: string;
  price?: {
    registration: { amount: number; currency: string };
    renewal?: { amount: number; currency: string };
    listRegistration?: { amount: number; currency: string };
    promo?: boolean;
  };
};

export default function SearchPage() {
  const router = useRouter();
  const add = useCart((s) => s.add);
  const { data: registrars } = useQuery({
    queryKey: ["registrars"],
    queryFn: () => api<{ registrars: Array<{ id: string; name: string }> }>("/api/registrars"),
  });
  const [registrarId, setRegistrarId] = useState("");
  const [single, setSingle] = useState("");
  const [bulk, setBulk] = useState("");
  const [singleResult, setSingleResult] = useState<CheckResult | null>(null);
  const [bulkResults, setBulkResults] = useState<CheckResult[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [balance, setBalance] = useState<{ amount: number; currency: string } | null>(null);
  const [loading, setLoading] = useState(false);

  const selectedItems = bulkResults.filter((r) => selected.includes(r.domain) && r.available);
  const total = selectedItems.reduce((sum, item) => sum + (item.price?.registration.amount ?? 0), 0);

  async function checkOne() {
    setLoading(true);
    try {
      const result = await api<CheckResult>("/api/domains/check", {
        method: "POST",
        body: JSON.stringify({ domain: single, registrarId: registrarId || undefined }),
      });
      setSingleResult(result);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Check failed");
    } finally {
      setLoading(false);
    }
  }

  async function checkBulk() {
    setLoading(true);
    try {
      const domains = parseDomainList(bulk);
      const data = await api<{ results: CheckResult[]; balance: { amount: number; currency: string } | null }>(
        "/api/domains/check-bulk",
        { method: "POST", body: JSON.stringify({ domains, registrarId: registrarId || undefined }) },
      );
      setBulkResults(data.results);
      setBalance(data.balance);
      setSelected(data.results.filter((r) => r.available).map((r) => r.domain));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Check failed");
    } finally {
      setLoading(false);
    }
  }

  const registrarOptions = useMemo(() => registrars?.registrars ?? [], [registrars]);

  return (
    <div>
      <PageHeader title="Domain search" description="Check one domain or paste a list." />
      <div className="mb-4 max-w-xs">
        <Select value={registrarId} onChange={(e) => setRegistrarId(e.target.value)}>
          <option value="">Default registrar</option>
          {registrarOptions.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </Select>
      </div>
      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <div className="mb-3 text-sm font-medium">Single check</div>
          <div className="flex gap-2">
            <Input placeholder="example.com" value={single} onChange={(e) => setSingle(e.target.value)} />
            <Button onClick={checkOne} disabled={loading || !single}>
              Check
            </Button>
          </div>
          {singleResult && (
            <div className="mt-5 space-y-2">
              <div className="text-lg font-semibold">{singleResult.domain}</div>
              <StatusBadge value={singleResult.available ? "available" : "unavailable"} />
              {singleResult.available && (
                <>
                  <div>Registration: <DomainPriceLabel price={singleResult.price} /></div>
                  {singleResult.price?.renewal && (
                    <div>Renewal: {formatMoney(singleResult.price.renewal.amount, singleResult.price.renewal.currency)}</div>
                  )}
                  <div className="text-sm text-muted-foreground">Registrar: {singleResult.registrar ?? "Regway"}</div>
                  <Button
                    className="mt-2"
                    onClick={() => {
                      add(
                        [{ domain: singleResult.domain, price: singleResult.price?.registration.amount, currency: singleResult.price?.registration.currency }],
                        registrarId || undefined,
                      );
                      router.push("/domains/purchase");
                    }}
                  >
                    Add to cart
                  </Button>
                </>
              )}
            </div>
          )}
        </Card>
        <Card>
          <div className="mb-3 text-sm font-medium">Bulk check</div>
          <Textarea
            placeholder={"domainone.com\ndomaintwo.net"}
            value={bulk}
            onChange={(e) => setBulk(e.target.value)}
          />
          <Button className="mt-3" onClick={checkBulk} disabled={loading || !bulk.trim()}>
            Check domains
          </Button>
        </Card>
      </div>
      {bulkResults.length > 0 && (
        <Card className="mt-6">
          <div className="space-y-2">
            {bulkResults.map((item) => (
              <label key={item.domain} className="flex items-center gap-3 rounded-md px-2 py-1.5 hover:bg-muted">
                <input
                  type="checkbox"
                  disabled={!item.available}
                  checked={selected.includes(item.domain)}
                  onChange={(e) =>
                    setSelected((curr) =>
                      e.target.checked ? [...curr, item.domain] : curr.filter((d) => d !== item.domain),
                    )
                  }
                />
                <span className="w-64 font-medium">{item.domain}</span>
                <StatusBadge value={item.available ? "available" : "unavailable"} />
                {item.available && <DomainPriceLabel price={item.price} />}
              </label>
            ))}
          </div>
          <div className="mt-4 grid gap-1 text-sm">
            <div>Selected: {selectedItems.length} domains</div>
            <div>Total: {formatMoney(total, selectedItems[0]?.price?.registration.currency ?? "USD")}</div>
            {balance && <div>Registrar balance: {formatMoney(balance.amount, balance.currency)}</div>}
            {balance && (
              <div>Balance after purchase: {formatMoney(balance.amount - total, balance.currency)}</div>
            )}
          </div>
          <Button
            className="mt-4"
            disabled={!selectedItems.length}
            onClick={() => {
              add(
                selectedItems.map((item) => ({
                  domain: item.domain,
                  price: item.price?.registration.amount,
                  currency: item.price?.registration.currency,
                })),
                registrarId || undefined,
              );
              router.push("/domains/purchase");
            }}
          >
            Continue
          </Button>
        </Card>
      )}
    </div>
  );
}
