// Integer centavos/basis points avoid floating-point commission drift.
export function cents(value: number | string): number {
  const text = String(value);
  if (!/^\d+(?:\.\d{1,2})?$/.test(text))
    throw new Error(
      "Money must be a non-negative amount with at most two decimals",
    );
  const [whole, fraction = ""] = text.split(".");
  const result = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(result))
    throw new Error("Money exceeds the supported range");
  return result;
}
export const pesos = (value: number) => value / 100;
export function packageCommission(line: {
  quantity: number;
  sellingPrice: number;
  commissionType: "FIXED" | "PERCENTAGE";
  commissionValue: number;
}): number {
  if (line.commissionType === "FIXED")
    return line.quantity * cents(line.commissionValue);
  const numerator =
    BigInt(line.quantity) *
    BigInt(cents(line.sellingPrice)) *
    BigInt(cents(line.commissionValue));
  return Number((numerator + 5000n) / 10000n);
}
