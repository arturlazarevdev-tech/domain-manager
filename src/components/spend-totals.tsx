import { formatMoney } from "@/lib/utils";
import type { SpendTotal } from "@/lib/services/spending";

export function SpendTotals({ totals }: { totals: SpendTotal[] }) {
  if (!totals.length) return <div className="text-sm text-muted-foreground">No spend yet.</div>;
  return <>{totals.map((total) => <div key={total.currency} className="mt-2">
    <div className="font-semibold">{formatMoney(total.spend, total.currency)}</div>
    <div className="text-xs text-muted-foreground">This month {formatMoney(total.spendThisMonth, total.currency)}</div>
  </div>)}</>;
}
