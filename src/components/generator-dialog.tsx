"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { TldCombobox } from "@/components/tld-combobox";
import { Button } from "@/components/ui/button";
import { Dialog, Field } from "@/components/ui/dialog";
import { Input } from "@/components/ui/primitives";
import { api } from "@/lib/api/client";
import { FALLBACK_TLDS } from "@/lib/integrations/registrars/regway/product-keys";
import { DomainPriceLabel } from "@/components/domain-price";

type CheckResult = {
  domain: string;
  available?: boolean;
  status?: "pending" | "available" | "taken";
  selected?: boolean;
  price?: {
    registration: { amount: number; currency: string };
    listRegistration?: { amount: number; currency: string };
    promo?: boolean;
  };
};

export function GeneratorDialog({
  open,
  onClose,
  registrarId,
  registrarProvider,
  onUse,
}: {
  open: boolean;
  onClose: () => void;
  registrarId?: string;
  registrarProvider?: string;
  onUse: (domains: string[]) => void;
}) {
  const { data: tlds } = useQuery({
    queryKey: ["tlds", registrarId],
    queryFn: () => api<{ tlds: string[] }>(`/api/registrars/${registrarId}/tlds`),
    enabled: Boolean(registrarId),
  });
  const [keyword, setKeyword] = useState("");
  const [tld, setTld] = useState("com");
  const [amount, setAmount] = useState(10);
  const [minLength, setMinLength] = useState(8);
  const [maxLength, setMaxLength] = useState(12);
  const [type, setType] = useState<"pronounceable" | "random" | "keyword" | "suggestions">("pronounceable");
  const generationType = type === "suggestions" && registrarProvider !== "dynadot" ? "pronounceable" : type;
  const [lettersOnly, setLettersOnly] = useState(true);
  const [noNumbers, setNoNumbers] = useState(true);
  const [noHyphens, setNoHyphens] = useState(true);
  const [rows, setRows] = useState<CheckResult[]>([]);
  const [exclude, setExclude] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [takenSkipped, setTakenSkipped] = useState(0);

  const zoneList = tlds?.tlds?.length ? tlds.tlds : FALLBACK_TLDS;
  const selectedAvailable = rows.filter((row) => row.selected !== false);

  const payload = useMemo(
    () => ({
      registrarId: registrarId || undefined,
      tld,
      amount,
      minLength,
      maxLength,
      keyword: keyword.trim() || undefined,
      type: generationType,
      filters: { lettersOnly, noNumbers, noHyphens },
    }),
    [registrarId, tld, amount, minLength, maxLength, keyword, generationType, lettersOnly, noNumbers, noHyphens],
  );

  async function generate(more = false) {
    setLoading(true);
    try {
      const data = await api<{
        available: CheckResult[];
        taken: { domain: string }[];
        generated: number;
        timedOut: boolean;
      }>("/api/domains/generate", {
        method: "POST",
        body: JSON.stringify({
          ...payload,
          exclude: more ? exclude : [],
        }),
      });
      const next = data.available.map((item) => ({
        domain: item.domain,
        available: true,
        status: "available" as const,
        selected: true,
        price: item.price,
      }));
      setRows(more ? [...rows, ...next] : next);
      setTakenSkipped((curr) => (more ? curr : 0) + data.taken.length);
      const seen = [
        ...data.available.map((item) => item.domain),
        ...data.taken.map((item) => item.domain),
      ];
      setExclude((curr) => (more ? [...curr, ...seen] : seen));
      if (!next.length) {
        toast.error(generationType === "suggestions" ? "No suggestions match. Change the keyword or length filters." : "No available names yet. Increase length or try Generate More.");
      } else if (data.timedOut) {
        toast.info(generationType === "suggestions" ? `Found ${next.length} of ${amount}. Change the keyword or widen the length filters for more.` : `Found ${next.length} of ${amount}. Try longer names or Generate More.`);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Generate failed");
    } finally {
      setLoading(false);
    }
  }

  async function copyAvailable() {
    const list = selectedAvailable.map((row) => row.domain);
    if (!list.length) return;
    await navigator.clipboard.writeText(list.join("\n"));
    toast.success(`${list.length} domains copied`);
  }

  return (
    <Dialog open={open} onClose={onClose} title="Generate Domains" className="max-w-3xl">
      <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
        <div className="grid gap-3">
          <Field label={generationType === "suggestions" ? "Keyword (required)" : "Keyword"}>
            <Input value={keyword} placeholder={generationType === "suggestions" ? "e.g. travel, nova, cobalt" : "Optional — kit, win, brand"} onChange={(e) => setKeyword(e.target.value)} />
          </Field>
          <Field label="Domain zone">
            <TldCombobox value={tld} tlds={zoneList} onChange={setTld} />
          </Field>
          <Field label="How many available">
            <Input type="number" min={1} max={100} value={amount} onChange={(e) => setAmount(Number(e.target.value) || 1)} />
          </Field>
          <Field label="Style">
            <select
              className="h-9 w-full rounded-md border bg-card px-3 text-sm"
              value={generationType}
              onChange={(e) => setType(e.target.value as typeof type)}
            >
              <option value="pronounceable">Pronounceable</option>
              <option value="random">Random</option>
              <option value="keyword">Keyword based</option>
              {registrarProvider === "dynadot" && <option value="suggestions">Dynadot suggestions</option>}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Min length">
              <Input type="number" min={3} max={20} value={minLength} onChange={(e) => setMinLength(Number(e.target.value) || 3)} />
            </Field>
            <Field label="Max length">
              <Input type="number" min={3} max={24} value={maxLength} onChange={(e) => setMaxLength(Number(e.target.value) || 8)} />
            </Field>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={lettersOnly} onChange={(e) => setLettersOnly(e.target.checked)} />
            Letters only
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={noNumbers} onChange={(e) => setNoNumbers(e.target.checked)} />
            No numbers
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={noHyphens} onChange={(e) => setNoHyphens(e.target.checked)} />
            No hyphens
          </label>
          <Button onClick={() => generate(false)} disabled={loading || (generationType === "suggestions" && !keyword.trim())}>
            {loading ? "Finding available..." : "Find available"}
          </Button>
          <p className="text-xs text-muted-foreground">
            {generationType === "suggestions" ? "Dynadot suggests names related to your keyword. Availability and first-year prices are checked before showing results." : "Short names are often taken. The generator keeps checking until it finds the requested number."}
          </p>
        </div>
        <div>
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="text-sm font-medium">Available domains</div>
            {(rows.length > 0 || takenSkipped > 0) && (
              <div className="text-xs text-muted-foreground">
                {rows.length} found
                {takenSkipped > 0 ? ` · ${takenSkipped} taken skipped` : ""}
              </div>
            )}
          </div>
          <div className="max-h-[420px] overflow-auto rounded-lg border">
            {rows.map((row) => (
              <label
                key={row.domain}
                className="flex items-center justify-between gap-3 border-b px-3 py-2 text-sm last:border-b-0"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <input
                    type="checkbox"
                    checked={row.selected !== false}
                    onChange={(e) =>
                      setRows((curr) =>
                        curr.map((item) => (item.domain === row.domain ? { ...item, selected: e.target.checked } : item)),
                      )
                    }
                  />
                  <span className="truncate font-medium">{row.domain}</span>
                </span>
                <span className="flex shrink-0 items-center gap-2 text-xs">
                  <span className="text-emerald-600">Available</span>
                  {row.price && <DomainPriceLabel price={row.price} />}
                </span>
              </label>
            ))}
            {!rows.length && (
              <div className="px-3 py-16 text-center text-sm text-muted-foreground">
                {loading ? "Checking names at the registrar..." : "Find available names to fill this list."}
              </div>
            )}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="outline" disabled={!selectedAvailable.length} onClick={copyAvailable}>
              Copy Available
            </Button>
            <Button
              disabled={!selectedAvailable.length}
              onClick={() => {
                onUse(selectedAvailable.map((row) => row.domain));
                onClose();
              }}
            >
              Use Available Domains
            </Button>
            <Button variant="outline" disabled={loading || (generationType === "suggestions" && !keyword.trim())} onClick={() => generate(true)}>
              Generate More
            </Button>
          </div>
        </div>
      </div>
    </Dialog>
  );
}
