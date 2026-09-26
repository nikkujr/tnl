import ExcelJS from "exceljs";

export type ImportSection = "STORE_SALES" | "HOME_CREDIT" | "CI_AGENT" | "CI_PAYMENT";

export interface ParsedRow {
  sheetName: string;
  section: ImportSection;
  rowNumber: number;
  orderDate: string; // YYYY-MM-DD
  customerName: string | null;
  productName: string | null;
  agentName: string | null;
  imei: string | null;
  note: string | null;
  orNo: string | null;
  unitPrice: number | null;
  cashReceived: number | null;
  paymentStatus: "PAID" | "PARTIALLY_PAID";
  paymentMethod: string;
  issue: string | null;
}

const SECTION_HEADERS: Array<{ pattern: RegExp; section: ImportSection }> = [
  { pattern: /^STORE\s*SALES$/, section: "STORE_SALES" },
  { pattern: /^HOME\s*CREDIT$/, section: "HOME_CREDIT" },
  { pattern: /^C\.?I\.?\s*\/?\s*AGENT$/, section: "CI_AGENT" },
  { pattern: /^C\.?I\.?\s*PAYMENT$/, section: "CI_PAYMENT" }
];
// Recognized but intentionally not imported — still must close whatever section came before it.
const EXCLUDED_SECTION_PATTERN = /^EXPENSES$/;

function normalizeHeader(value: string): string {
  return value.trim().toUpperCase().replace(/\s+/g, " ");
}

function matchSection(label: string): ImportSection | null {
  const normalized = normalizeHeader(label);
  for (const candidate of SECTION_HEADERS) {
    if (candidate.pattern.test(normalized)) return candidate.section;
  }
  return null;
}

function isExcludedSectionHeader(label: string): boolean {
  return EXCLUDED_SECTION_PATTERN.test(normalizeHeader(label));
}

function isTotalRow(label: string): boolean {
  return normalizeHeader(label).startsWith("TOTAL");
}

type ColumnRole = "CUSTOMER" | "AGENT" | "PRODUCT" | "IMEI" | "NOTE" | "OR_NO" | "CASH" | "GCASH" | "DP" | "UNIT_PRICE";

function roleForHeader(label: string): ColumnRole | null {
  const normalized = normalizeHeader(label).replace(/\./g, "");
  if (normalized === "CUSTOMERS" || normalized === "CUSTOMER") return "CUSTOMER";
  if (normalized === "AGENT") return "AGENT";
  if (normalized === "UNITS" || normalized === "UNIT") return "PRODUCT";
  if (normalized.startsWith("IMEI")) return "IMEI";
  if (normalized === "FREEBIES" || normalized === "STATUS") return "NOTE";
  if (normalized === "OR NO") return "OR_NO";
  if (normalized === "CASH") return "CASH";
  if (normalized === "GCASH") return "GCASH";
  if (normalized === "DP") return "DP";
  if (normalized === "UNIT PRICE" || normalized === "UNIT PRICES") return "UNIT_PRICE";
  return null;
}

function cellText(cell: ExcelJS.Cell | undefined): string {
  if (!cell || cell.value === null || cell.value === undefined) return "";
  const value = cell.value;
  if (typeof value === "object" && value !== null && "richText" in (value as any)) {
    return (value as any).richText.map((part: any) => part.text).join("");
  }
  if (typeof value === "object" && value !== null && "text" in (value as any)) {
    return String((value as any).text ?? "");
  }
  return String(value).trim();
}

function cellNumber(cell: ExcelJS.Cell | undefined): number | null {
  if (!cell || cell.value === null || cell.value === undefined) return null;
  const raw = typeof cell.value === "object" && cell.value !== null && "result" in (cell.value as any)
    ? (cell.value as any).result
    : cell.value;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

const EXCEL_EPOCH_UTC = Date.UTC(1899, 11, 30);

function dateFromA1(worksheet: ExcelJS.Worksheet): string | null {
  const cell = worksheet.getCell("A1");
  const value = cell.value;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const numeric = cellNumber(cell);
  if (numeric && numeric > 20000 && numeric < 60000) {
    const date = new Date(EXCEL_EPOCH_UTC + numeric * 86400000);
    return date.toISOString().slice(0, 10);
  }
  return null;
}

const MONTH_ABBREVIATIONS: Record<string, number> = {
  JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12
};

function dateFromSheetName(sheetName: string, year: number): string | null {
  const match = sheetName.trim().toUpperCase().match(/^([A-Z]{3,9})\s*(\d{1,2})$/);
  if (!match) return null;
  const month = MONTH_ABBREVIATIONS[match[1]!.slice(0, 3)];
  const day = Number(match[2]);
  if (!month || !day) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function amountFromCash(cash: number | null, gcash: number | null): { total: number; method: string } {
  const cashValue = cash ?? 0;
  const gcashValue = gcash ?? 0;
  const total = cashValue + gcashValue;
  const method = cashValue > 0 && gcashValue > 0 ? "Cash + GCash" : gcashValue > 0 ? "GCash" : "Cash";
  return { total, method };
}

export interface ParsedWorkbook {
  rows: ParsedRow[];
  skippedSheets: string[];
}

export async function parseSalesReport(buffer: Buffer): Promise<ParsedWorkbook> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as any);
  const rows: ParsedRow[] = [];
  const skippedSheets: string[] = [];

  const directDates = workbook.worksheets.map((worksheet) => dateFromA1(worksheet));
  const yearCounts = new Map<number, number>();
  for (const date of directDates) {
    if (!date) continue;
    const year = Number(date.slice(0, 4));
    yearCounts.set(year, (yearCounts.get(year) ?? 0) + 1);
  }
  const dominantYear = [...yearCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? new Date().getFullYear();

  for (let sheetIndex = 0; sheetIndex < workbook.worksheets.length; sheetIndex++) {
    const worksheet = workbook.worksheets[sheetIndex]!;
    const orderDate = directDates[sheetIndex] ?? dateFromSheetName(worksheet.name, dominantYear);
    if (!orderDate) {
      skippedSheets.push(worksheet.name);
      continue;
    }

    let currentSection: ImportSection | null = null;
    let columnRoles: Map<number, ColumnRole> | null = null;

    const maxRow = worksheet.actualRowCount || worksheet.rowCount;
    for (let rowNumber = 1; rowNumber <= maxRow; rowNumber++) {
      const row = worksheet.getRow(rowNumber);
      const labelCell = cellText(row.getCell(1));

      // Check for a section header on every row (not just while between sections): some day-sheets
      // omit the literal "TOTAL" row for an empty section, so the previous section's state can still
      // be open when the next section's (often merged-cell) banner row arrives.
      const sectionHeader = matchSection(labelCell);
      if (sectionHeader) {
        currentSection = sectionHeader;
        columnRoles = null;
        continue;
      }
      if (isExcludedSectionHeader(labelCell)) {
        currentSection = null;
        columnRoles = null;
        continue;
      }

      if (!currentSection) continue;

      if (!columnRoles) {
        // This should be the header row directly under the section label.
        const roles = new Map<number, ColumnRole>();
        row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
          const role = roleForHeader(cellText(cell));
          if (role) roles.set(colNumber, role);
        });
        if (roles.size > 0) columnRoles = roles;
        continue;
      }

      if (isTotalRow(labelCell)) {
        currentSection = null;
        columnRoles = null;
        continue;
      }

      const fields: Partial<Record<ColumnRole, string>> = {};
      for (const [colNumber, role] of columnRoles) {
        fields[role] = cellText(row.getCell(colNumber));
      }
      const customerName = fields.CUSTOMER?.trim() || null;
      const productName = fields.PRODUCT?.trim() || null;
      if (!customerName && !productName) continue; // unused template line

      const agentName = fields.AGENT?.trim() || null;
      const imei = fields.IMEI?.trim() || null;
      const note = fields.NOTE?.trim() || null;
      const orNo = fields.OR_NO?.trim() || null;
      const cash = fields.CASH ? Number(fields.CASH.replace(/,/g, "")) || 0 : null;
      const gcash = fields.GCASH ? Number(fields.GCASH.replace(/,/g, "")) || 0 : null;
      const dp = fields.DP ? Number(fields.DP.replace(/,/g, "")) || 0 : null;
      const unitPriceField = fields.UNIT_PRICE ? Number(fields.UNIT_PRICE.replace(/,/g, "")) || 0 : null;

      let unitPrice: number | null = null;
      let cashReceived: number | null = null;
      let paymentStatus: "PAID" | "PARTIALLY_PAID" = "PAID";
      let paymentMethod = "Cash";
      let issue: string | null = null;

      if (currentSection === "STORE_SALES" || currentSection === "CI_PAYMENT") {
        const { total, method } = amountFromCash(cash, gcash);
        unitPrice = total > 0 ? total : null;
        cashReceived = unitPrice;
        paymentMethod = method;
        paymentStatus = "PAID";
      } else {
        const fullPrice = unitPriceField && unitPriceField > 0 ? unitPriceField : dp;
        unitPrice = fullPrice && fullPrice > 0 ? fullPrice : null;
        cashReceived = dp ?? null;
        paymentStatus = unitPrice !== null && cashReceived !== null && cashReceived >= unitPrice ? "PAID" : "PARTIALLY_PAID";
        paymentMethod = currentSection === "HOME_CREDIT" ? "Home Credit" : "Installment (Agent)";
      }

      if (!customerName) issue = "Missing customer name";
      else if (!productName) issue = "Missing product name";
      else if (unitPrice === null || unitPrice <= 0) issue = "Missing sale amount";

      rows.push({
        sheetName: worksheet.name,
        section: currentSection,
        rowNumber,
        orderDate,
        customerName,
        productName,
        agentName,
        imei,
        note,
        orNo,
        unitPrice,
        cashReceived,
        paymentStatus,
        paymentMethod,
        issue
      });
    }
  }

  return { rows, skippedSheets };
}
