/**
 * Money helpers — money is stored as integer kobo (minor units) + a currency column.
 * Never pass floats into these; never do arithmetic on formatted strings.
 */
export function formatKobo(kobo: number, currency = "NGN"): string {
  const intl = new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency,
    currencyDisplay: "narrowSymbol",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return intl.format(kobo / 100);
}

export const KOBO_PER_NAIRA = 100;

export function nairaToKobo(naira: number): number {
  return Math.round(naira * KOBO_PER_NAIRA);
}

export function koboToNaira(kobo: number): number {
  return kobo / KOBO_PER_NAIRA;
}
