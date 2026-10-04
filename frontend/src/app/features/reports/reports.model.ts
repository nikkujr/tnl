export type ReportPeriod = 'daily' | 'monthly' | 'overall';
export interface ProductMovement {
  id: number;
  name: string;
  sku: string;
  unitsSold: number;
  stockOnHand: number;
  stockReserved: number;
  available: number;
  lastSoldDate: string | null;
}
export interface BusinessReport {
  period: ReportPeriod;
  selection: string;
  timeZone: string;
  totals: {
    completedSales: number;
    revenue: number;
    averageSale: number;
    buyingCustomers: number;
    historicalDateSales: number;
  };
  trend: Array<{ label: string; revenue: number; orders: number }>;
  fastProducts: ProductMovement[];
  slowProducts: ProductMovement[];
  stockAlerts: ProductMovement[];
  customers: Array<{ id: number; name: string; revenue: number; orders: number }>;
  packages: Array<{ id: number; name: string; unitsSold: number; revenue: number }>;
  statuses: Array<{ status: string; orders: number; value: number }>;
  payments: Array<{ status: string; orders: number; value: number }>;
  stock: { activeProducts: number; lowStockProducts: number; availableUnits: number };
}

export function fillTrend(report: BusinessReport) {
  if (report.period === 'overall') return report.trend;
  const values = new Map(report.trend.map((row) => [row.label, row]));
  const count =
    report.period === 'daily'
      ? 24
      : new Date(
          Date.UTC(Number(report.selection.slice(0, 4)), Number(report.selection.slice(5, 7)), 0),
        ).getUTCDate();
  return Array.from({ length: count }, (_, index) => {
    const label =
      report.period === 'daily'
        ? `${report.selection} ${String(index).padStart(2, '0')}:00`
        : `${report.selection}-${String(index + 1).padStart(2, '0')}`;
    return values.get(label) ?? { label, revenue: 0, orders: 0 };
  });
}
