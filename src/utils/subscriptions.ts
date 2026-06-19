import type { SubscriptionRate } from "../types";

export function formatSubscriptionRateDisplay(rate: SubscriptionRate | null): string {
  if (!rate) return "";

  const currency = rate.currency === "USD" ? "$" : rate.currency;
  const amount = formatAmount(rate.amount);
  const price = currency === "$" ? `${currency}${amount}` : `${amount} ${currency}`;
  const interval =
    rate.intervalCount === 1
      ? singularIntervalUnit(rate.intervalUnit)
      : `${rate.intervalCount} ${rate.intervalUnit}`;

  return `${price}/${interval}`;
}

function formatAmount(amount: number): string {
  return Number.isInteger(amount) ? String(amount) : amount.toFixed(2).replace(/\.00$/, "");
}

function singularIntervalUnit(unit: SubscriptionRate["intervalUnit"]): string {
  return unit.endsWith("s") ? unit.slice(0, -1) : unit;
}
