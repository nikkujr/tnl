/**
 * Normalizes Philippine mobile numbers to a consistent 09XXXXXXXXX form.
 * Accepts optional +63/63 country code and any spaces, dashes, or parentheses.
 * Returns null when the input cannot be normalized into a valid PH mobile number.
 */
export function normalizePhPhone(input: string): string | null {
  const stripped = input.trim().replace(/[\s\-().]/g, "");
  let digits: string;
  if (stripped.startsWith("+63")) digits = `0${stripped.slice(3)}`;
  else if (stripped.startsWith("63") && stripped.length === 12) digits = `0${stripped.slice(2)}`;
  else digits = stripped;
  return /^09\d{9}$/.test(digits) ? digits : null;
}
