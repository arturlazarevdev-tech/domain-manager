import { formatMoney } from "@/lib/utils";

type Price = {
  registration: { amount: number; currency: string };
  listRegistration?: { amount: number; currency: string };
  promo?: boolean;
};

export function DomainPriceLabel({ price }: { price?: Price | null }) {
  if (!price) return <>—</>;
  const current = formatMoney(price.registration.amount, price.registration.currency);
  const list = price.listRegistration;
  const showList = Boolean(price.promo && list && list.amount > price.registration.amount);
  return (
    <span className="tabular-nums">
      {showList && list ? (
        <span className="mr-1.5 text-muted-foreground line-through">
          {formatMoney(list.amount, list.currency)}
        </span>
      ) : null}
      <span>{current}</span>
    </span>
  );
}
