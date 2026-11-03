// All weights are integer tenths of a kg (1232.0 kg -> 12320).
// All money is integer paisa (Rs 59,752.00 -> 5975200).
// Rule from the brief: net weight is reduced by 1% for each moisture point above 12%.

export const MOISTURE_BASE_TENTHS = 120; // 12.0%
export const DEDUCTION_PERCENT_PER_POINT = 1;

export function netTenths(grossTenths: number, tareTenths: number, moistureTenths: number): number {
  const raw = grossTenths - tareTenths;
  if (raw <= 0) return 0;
  const pointsOver = Math.max(0, moistureTenths - MOISTURE_BASE_TENTHS) / 10;
  const factor = 1 - (pointsOver * DEDUCTION_PERCENT_PER_POINT) / 100;
  return Math.max(0, Math.round(raw * factor));
}

export function amountPaisa(netTenthsValue: number, rateRupeesPerQuintal: number): number {
  // quintals = netTenths / 1000 ; paisa = quintals * rate * 100 = netTenths * rate / 10
  return Math.round((netTenthsValue * rateRupeesPerQuintal) / 10);
}

export function fmtKg(tenths: number): string {
  return (tenths / 10).toFixed(1);
}

export function fmtMoisture(tenths: number): string {
  return (tenths / 10).toFixed(1);
}

// Indian digit grouping: 59,752.00 / 40,303.50 / 1,23,456.78
export function fmtINR(paisa: number): string {
  const neg = paisa < 0;
  const p = Math.abs(Math.round(paisa));
  const rupees = Math.floor(p / 100);
  const rem = String(p % 100).padStart(2, '0');
  const s = String(rupees);
  let out: string;
  if (s.length <= 3) {
    out = s;
  } else {
    const last3 = s.slice(-3);
    let rest = s.slice(0, -3);
    const parts: string[] = [];
    while (rest.length > 2) {
      parts.unshift(rest.slice(-2));
      rest = rest.slice(0, -2);
    }
    if (rest) parts.unshift(rest);
    out = parts.join(',') + ',' + last3;
  }
  return (neg ? '-' : '') + out + '.' + rem;
}

// Parse a user-typed decimal ("1232.0") into tenths; null when invalid.
export function parseTenths(input: string): number | null {
  const trimmed = input.trim();
  if (!/^\d+(\.\d)?$/.test(trimmed)) return null;
  return Math.round(parseFloat(trimmed) * 10);
}
