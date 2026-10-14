export type ReportDomain = {
  domain: string;
  purchasedAt?: string | null;
  purchasePrice: number;
  currency: string;
  status: string;
  registrar: { name: string };
  buyer: { name: string } | null;
  buyerGroup: { name: string } | null;
  cloudflare: { status: string; account: { name: string } } | null;
  dns: { ip: string | null };
  server: { name: string } | null;
  group: string | null;
};

// Calendar days follow the same browser timezone as the Purchased column.
export function purchaseDay(value?: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function matchesPurchaseDates(value: string | null | undefined, from: string, to: string) {
  if (from && to && from > to) return false;
  if (!from && !to) return true;
  const day = purchaseDay(value);
  return Boolean(day && (!from || day >= from) && (!to || day <= to));
}

export function reportTotals(domains: Pick<ReportDomain, "purchasePrice" | "currency">[]) {
  const cents = new Map<string, number>();
  for (const row of domains) {
    cents.set(row.currency, (cents.get(row.currency) ?? 0) + Math.round(row.purchasePrice * 100));
  }
  return Array.from(cents, ([currency, amount]) => ({ currency, amount: amount / 100 }));
}

function csvCell(value: string | number | null | undefined) {
  let text = String(value ?? "");
  // Spreadsheet applications must treat names and other user text as plain values.
  if (typeof value === "string" && /^[\s]*[=+@-]/.test(text)) text = "'" + text;
  return `"${text.replace(/"/g, '""')}"`;
}

export function domainReportCsv(domains: ReportDomain[]) {
  const rows: Array<Array<string | number | null | undefined>> = [[
    "Domain", "Purchased date (local)", "Purchased at (UTC)", "Buyer", "Buyer group", "Purchase for", "Registrar",
    "Price", "Currency", "Status", "Cloudflare", "Cloudflare status", "DNS IP", "Server", "Keitaro group",
  ]];
  for (const row of domains) {
    const day = purchaseDay(row.purchasedAt);
    rows.push([
      row.domain, day, day ? new Date(row.purchasedAt!).toISOString() : "", row.buyer?.name, row.buyerGroup?.name,
      row.buyer ? "Buyer" : row.buyerGroup ? "Group needs" : "Unassigned", row.registrar.name,
      row.purchasePrice.toFixed(2), row.currency, row.status, row.cloudflare?.account.name,
      row.cloudflare?.status, row.dns?.ip, row.server?.name, row.group,
    ]);
  }
  if (domains.length) {
    rows.push([]);
    for (const total of reportTotals(domains)) {
      const row: Array<string | number> = Array(15).fill("");
      row[0] = `Total: ${domains.filter((domain) => domain.currency === total.currency).length} domains`;
      row[7] = total.amount.toFixed(2);
      row[8] = total.currency;
      rows.push(row);
    }
  }
  return "\uFEFF" + rows.map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
