import { formatMoney } from "@/lib/utils";
import type { DomainPrice } from "@/lib/integrations/types";

type Price = Pick<DomainPrice, "registration" | "listRegistration" | "promo" | "estimated" | "recentRegistration">;

export function DomainPriceLabel({ price }: { price?: Price | null }) {
  if (!price) return <>—</>;
  const current = formatMoney(price.registration.amount, price.registration.currency);
  const list = price.listRegistration;
  const showList = Boolean(price.promo && list && list.amount > price.registration.amount);
  const recent = price.estimated ? price.recentRegistration : undefined;
  if (recent) {
    const date = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "Europe/Kiev" }).format(new Date(recent.chargedAt));
    return (
      <span className="inline-flex flex-col tabular-nums" title={`Charged for ${recent.domain} on ${date}. Historical price; the current registration price is unconfirmed.`}>
        <span>Recent charge: {formatMoney(recent.amount, recent.currency)}</span>
        <span className="text-xs text-muted-foreground">{date} · catalog estimate: {current}</span>
      </span>
    );
  }
  return (
    <span className="tabular-nums" title={price.estimated ? "Base catalog estimate. Registrar promotions may reduce the actual charge at registration." : undefined}>
      {showList && list ? (
        <span className="mr-1.5 text-muted-foreground line-through">
          {formatMoney(list.amount, list.currency)}
        </span>
      ) : null}
      <span>{current}</span>
      {price.estimated ? <span className="ml-1.5 text-xs text-muted-foreground">estimate</span> : null}
    </span>
  );
}
