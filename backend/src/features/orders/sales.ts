import { randomBytes } from "node:crypto";
import type { PoolConnection } from "mysql2/promise";
import { HttpError } from "../../shared/http.js";
import { cents, packageCommission, pesos } from "../../shared/money.js";
import { jsonValue } from "../../shared/transaction.js";
import {
  enqueue,
  event,
  notify,
  orderChanged,
  staffRecipients,
} from "../automations/events.js";
export interface Component {
  productId: number;
  productName: string;
  sku: string;
  quantity: number;
}
export interface Item extends Component {
  unitPrice: number;
}
export interface PackageLine {
  packageId: number;
  name: string;
  quantity: number;
  sellingPrice: number;
  commissionType: "FIXED" | "PERCENTAGE";
  commissionValue: number;
  components: Component[];
}
export interface Sale {
  items: Item[];
  packages: PackageLine[];
}
export function totalCents(s: Sale) {
  const total =
    s.items.reduce((a, i) => a + cents(i.unitPrice) * i.quantity, 0) +
    s.packages.reduce((a, p) => a + cents(p.sellingPrice) * p.quantity, 0);
  if (!Number.isSafeInteger(total) || total > 999999999999)
    throw new HttpError(400, "Order total exceeds the supported range");
  return total;
}
export function requirements(
  s: Sale,
): Array<{ productId: number; quantity: number }> {
  const totals = new Map<number, number>();
  for (const i of s.items)
    totals.set(i.productId, (totals.get(i.productId) ?? 0) + i.quantity);
  for (const p of s.packages)
    for (const i of p.components)
      totals.set(
        i.productId,
        (totals.get(i.productId) ?? 0) + i.quantity * p.quantity,
      );
  for (const quantity of totals.values())
    if (!Number.isSafeInteger(quantity) || quantity > 4294967295)
      throw new HttpError(
        400,
        "Component quantity exceeds the supported range",
      );
  return [...totals]
    .sort(([a], [b]) => a - b)
    .map(([productId, quantity]) => ({ productId, quantity }));
}
export async function checkStock(c: PoolConnection, s: Sale, lock = false) {
  for (const i of requirements(s)) {
    const [rows] = await c.query<any[]>(
      `SELECT active,stock_on_hand,stock_reserved FROM products WHERE id=?${lock ? " FOR UPDATE" : ""}`,
      [i.productId],
    );
    const p = rows[0];
    if (!p?.active || p.stock_on_hand - p.stock_reserved < i.quantity)
      throw new HttpError(
        409,
        `Product ${i.productId} is unavailable or has insufficient stock`,
      );
  }
}
export async function quote(
  c: PoolConnection,
  input: {
    items?: Array<{ productId: number; quantity: number }>;
    packages?: Array<{ packageId: number; quantity: number }>;
  },
): Promise<Sale> {
  const s: Sale = { items: [], packages: [] };
  for (const i of input.items ?? []) {
    const [rows] = await c.query<any[]>(
      "SELECT id,name,sku,price FROM products WHERE id=? AND active=TRUE",
      [i.productId],
    );
    if (!rows[0]) throw new HttpError(400, "Selected product is unavailable");
    s.items.push({
      productId: i.productId,
      productName: rows[0].name,
      sku: rows[0].sku,
      unitPrice: Number(rows[0].price),
      quantity: i.quantity,
    });
  }
  for (const i of input.packages ?? []) {
    const [rows] = await c.query<any[]>(
      "SELECT * FROM packages WHERE id=? AND active=TRUE LOCK IN SHARE MODE",
      [i.packageId],
    );
    if (!rows[0]) throw new HttpError(400, "Selected package is unavailable");
    const p = rows[0];
    const [components] = await c.query<any[]>(
      "SELECT pi.product_id productId,p.name productName,p.sku,pi.quantity FROM package_items pi JOIN products p ON p.id=pi.product_id WHERE pi.package_id=? ORDER BY pi.product_id",
      [i.packageId],
    );
    if (!components.length)
      throw new HttpError(409, "Package has no components");
    s.packages.push({
      packageId: i.packageId,
      name: p.name,
      quantity: i.quantity,
      sellingPrice: Number(p.selling_price),
      commissionType: p.commission_type,
      commissionValue: Number(p.commission_value),
      components,
    });
  }
  if (!s.items.length && !s.packages.length)
    throw new HttpError(400, "Select at least one product or package");
  totalCents(s);
  const commission = s.packages.reduce(
    (sum, p) => sum + packageCommission(p),
    0,
  );
  if (!Number.isSafeInteger(commission) || commission > 999999999999)
    throw new HttpError(400, "Commission exceeds the supported range");
  await checkStock(c, s);
  return s;
}
export async function readSale(
  c: Pick<PoolConnection, "query">,
  orderId: number,
): Promise<Sale> {
  const [items] = await c.query<any[]>(
    "SELECT product_id productId,product_name productName,sku,quantity,unit_price unitPrice FROM order_items WHERE order_id=? ORDER BY id",
    [orderId],
  );
  const [packs] = await c.query<any[]>(
    "SELECT package_id packageId,name,quantity,selling_price sellingPrice,commission_type commissionType,commission_value commissionValue,components FROM order_packages WHERE order_id=? ORDER BY id",
    [orderId],
  );
  return {
    items,
    packages: packs.map((p) => ({
      ...p,
      components: jsonValue<Component[]>(p.components),
    })),
  };
}
export async function saveSale(c: PoolConnection, id: number, s: Sale) {
  for (const i of s.items)
    await c.execute(
      "INSERT INTO order_items(order_id,product_id,quantity,unit_price,product_name,sku) VALUES(?,?,?,?,?,?)",
      [id, i.productId, i.quantity, i.unitPrice, i.productName, i.sku],
    );
  for (const p of s.packages)
    await c.execute(
      "INSERT INTO order_packages(order_id,package_id,name,quantity,selling_price,commission_type,commission_value,components) VALUES(?,?,?,?,?,?,?,?)",
      [
        id,
        p.packageId,
        p.name,
        p.quantity,
        p.sellingPrice,
        p.commissionType,
        p.commissionValue,
        JSON.stringify(p.components),
      ],
    );
}
export function cashPayment(
  total: number,
  method: string,
  received?: number | null,
  status?: string,
) {
  if (method !== "Cash")
    return {
      paymentStatus: status ?? "UNPAID",
      cashReceived: null,
      cashChange: null,
    };
  if (received == null) throw new HttpError(400, "Cash received is required");
  let amount: number;
  try {
    amount = cents(received);
  } catch {
    throw new HttpError(400, "Cash received must have at most two decimals");
  }
  const paymentStatus = status ?? "PAID";
  const valid =
    paymentStatus === "UNPAID"
      ? amount === 0
      : paymentStatus === "PARTIALLY_PAID"
        ? amount > 0 && amount < total
        : amount >= total;
  if (!valid)
    throw new HttpError(
      400,
      "Cash received does not match the order total/payment status",
    );
  return {
    paymentStatus,
    cashReceived: received,
    cashChange: pesos(Math.max(0, amount - total)),
  };
}
export async function createSale(
  c: PoolConnection,
  input: {
    customerId: number;
    agentId: number;
    deliveryAddress: string;
    paymentMethod: string;
    cashReceived?: number | null;
  },
  s: Sale,
  actorId: number,
) {
  const [agents] = await c.query<any[]>(
    "SELECT id FROM users WHERE id=? AND role='AGENT' AND active=TRUE LOCK IN SHARE MODE",
    [input.agentId],
  );
  if (!agents.length) throw new HttpError(400, "Assigned agent must be active");
  const [customers] = await c.query<any[]>(
    "SELECT id FROM customers WHERE id=?",
    [input.customerId],
  );
  if (!customers.length) throw new HttpError(404, "Customer not found");
  await checkStock(c, s);
  const payment = cashPayment(
    totalCents(s),
    input.paymentMethod,
    input.cashReceived,
  );
  let trackingNumber = "",
    id = 0;
  for (let attempt = 0; attempt < 5; attempt++) {
    trackingNumber = `TNL-${randomBytes(10).toString("hex").toUpperCase()}`;
    try {
      const [r] = await c.execute<any>(
        "INSERT INTO orders(tracking_number,customer_id,agent_id,delivery_address,payment_method,payment_status,cash_received,cash_change,sales_version) VALUES(?,?,?,?,?,?,?,?,'PACKAGE')",
        [
          trackingNumber,
          input.customerId,
          input.agentId,
          input.deliveryAddress,
          input.paymentMethod,
          payment.paymentStatus,
          payment.cashReceived,
          payment.cashChange,
        ],
      );
      id = r.insertId;
      break;
    } catch (e: any) {
      if (e.code !== "ER_DUP_ENTRY" || attempt === 4) throw e;
    }
  }
  await saveSale(c, id, s);
  await c.execute(
    "INSERT INTO order_events(order_id,actor_id,type,message) VALUES(?,?,'CREATED',?)",
    [
      id,
      actorId,
      `Order created totaling ₱${pesos(totalCents(s)).toFixed(2)}.`,
    ],
  );
  await orderChanged(c, id, "order.created", "PENDING", actorId);
  return {
    id,
    trackingNumber,
    orderStatus: "PENDING",
    ...payment,
    total: pesos(totalCents(s)),
  };
}
export async function completeSale(
  c: PoolConnection,
  orderId: number,
  actorId: number,
) {
  const [rows] = await c.query<any[]>(
    "SELECT * FROM orders WHERE id=? FOR UPDATE",
    [orderId],
  );
  const o = rows[0];
  if (
    !o ||
    o.origin !== "LIVE" ||
    o.sales_version !== "PACKAGE" ||
    o.delivery_status !== "DELIVERED" ||
    o.payment_status !== "PAID" ||
    o.sale_completed_at
  )
    return;
  const sale = await readSale(c, orderId);
  await c.execute(
    "UPDATE orders SET sale_completed_at=UTC_TIMESTAMP() WHERE id=?",
    [orderId],
  );
  const breakdown = sale.packages.map((p) => ({
    packageId: p.packageId,
    name: p.name,
    quantity: p.quantity,
    commissionType: p.commissionType,
    commissionValue: p.commissionValue,
    amount: pesos(packageCommission(p)),
  }));
  if (breakdown.length) {
    const amount = pesos(breakdown.reduce((s, p) => s + cents(p.amount), 0));
    await c.execute(
      "INSERT INTO commissions(order_id,agent_id,rate,amount,breakdown,source) VALUES(?,?,NULL,?,?,'PACKAGE')",
      [orderId, o.agent_id, amount, JSON.stringify(breakdown)],
    );
    await notify(
      c,
      await staffRecipients(c, o.agent_id),
      `commission:${orderId}`,
      "COMMISSION",
      "Commission earned",
      `${o.tracking_number} · ₱${amount.toFixed(2)}`,
      `/orders/${orderId}`,
    );
  }
  const id = await event(
    c,
    "sale.completed",
    "ORDER",
    orderId,
    { trackingNumber: o.tracking_number },
    actorId,
  );
  const [settings] = await c.query<any[]>(
    "SELECT config FROM automation_settings WHERE workflow='PURCHASE_FOLLOWUP'",
  );
  const delayDays = Number(
    jsonValue<any>(settings[0]?.config ?? {}).delayDays ?? 3,
  );
  const [customers] = await c.query<any[]>(
    "SELECT full_name FROM customers WHERE id=?",
    [o.customer_id],
  );
  await enqueue(
    c,
    "PURCHASE_FOLLOWUP",
    `purchase:${orderId}`,
    {
      kind: "EMAIL",
      marketing: true,
      customerId: o.customer_id,
      orderId,
      vars: {
        trackingNumber: o.tracking_number,
        customerName: customers[0]?.full_name,
      },
    },
    new Date(Date.now() + delayDays * 86400000),
    id,
  );
}
