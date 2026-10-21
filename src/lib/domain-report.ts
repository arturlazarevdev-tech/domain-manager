export type ReportDomain = {
  domain: string;
  purchasedAt?: string | null;
  purchasePrice: number;
  currency: string;
  status: string;
  registrar: { id?: string; name: string };
  buyer: { id?: string; name: string } | null;
  buyerGroup: { id?: string; name: string } | null;
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

export type ReportGrouping = "registrar" | "buyerGroup" | "buyer";
export const REPORT_GROUP_LABELS: Record<ReportGrouping, string> = {
  registrar: "Registrar", buyerGroup: "Buyer group", buyer: "Buyer",
};
export type ReportGroup<T extends ReportDomain = ReportDomain> = {
  key: string; label: string; dimension: ReportGrouping; depth: number;
  domains: T[]; totals: ReturnType<typeof reportTotals>; children: ReportGroup<T>[];
};

export function groupDomainReport<T extends ReportDomain>(domains: T[], groupBy: readonly ReportGrouping[]): ReportGroup<T>[] {
  const dimensions = [...new Set(groupBy)];
  function group(rows: T[], depth: number, parent: string): ReportGroup<T>[] {
    const dimension = dimensions[depth];
    if (!dimension) return [];
    const buckets = new Map<string, { label: string; rows: T[] }>();
    for (const row of rows) {
      const entity = row[dimension];
      const key = JSON.stringify([dimension, entity ? [entity.id ? "id" : "name", entity.id ?? entity.name] : dimension === "buyer" && row.buyerGroup ? "groupNeeds" : null]);
      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = { label: entity?.name ?? (dimension === "buyer" && row.buyerGroup ? "Group needs" : "Unassigned"), rows: [] };
        buckets.set(key, bucket);
      }
      bucket.rows.push(row);
    }
    return [...buckets].map(([key, bucket]) => ({
      key: `${parent}/${key}`, label: bucket.label, dimension, depth, domains: bucket.rows,
      totals: reportTotals(bucket.rows), children: group(bucket.rows, depth + 1, `${parent}/${key}`),
    })).sort((a, b) => a.label.localeCompare(b.label) || a.key.localeCompare(b.key));
  }
  return group(domains, 0, "");
}

export function flattenReportGroups<T extends ReportDomain>(groups: ReportGroup<T>[]): ReportGroup<T>[] {
  return groups.flatMap(group => [group, ...flattenReportGroups(group.children)]);
}

function csvCell(value: string | number | null | undefined) {
  let text = String(value ?? "");
  // Spreadsheet applications must treat names and other user text as plain values.
  if (typeof value === "string" && /^[\s]*[=+@-]/.test(text)) text = "'" + text;
  return `"${text.replace(/"/g, '""')}"`;
}

export function domainReportCsv(domains: ReportDomain[], groupBy: readonly ReportGrouping[] = []) {
  const grouped = groupDomainReport(domains, groupBy);
  const groups = flattenReportGroups(grouped);
  const ordered = grouped.length ? groups.filter(group => !group.children.length).flatMap(group => group.domains) : domains;
  const rows: Array<Array<string | number | null | undefined>> = [[
    "Domain", "Purchased date (local)", "Purchased at (UTC)", "Buyer", "Buyer group", "Purchase for", "Registrar",
    "Price", "Currency", "Status", "Cloudflare", "Cloudflare status", "DNS IP", "Server", "Keitaro group",
  ]];
  for (const row of ordered) {
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
  if (groups.length) {
    rows.push([], ["Grouped spending report"], ["Level", "Group", "Parent groups", "Domains", "Total", "Currency"]);
    function summary(nodes: ReportGroup[], parents: string[]) {
      for (const group of nodes) {
        for (const total of group.totals) rows.push([
          REPORT_GROUP_LABELS[group.dimension], group.label, parents.join(" / "),
          group.domains.filter(domain => domain.currency === total.currency).length, total.amount.toFixed(2), total.currency,
        ]);
        summary(group.children, [...parents, `${REPORT_GROUP_LABELS[group.dimension]}: ${group.label}`]);
      }
    }
    summary(grouped, []);
  }
  return "\uFEFF" + rows.map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
