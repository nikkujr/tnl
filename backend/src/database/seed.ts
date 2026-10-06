import bcrypt from "bcryptjs";
import { randomBytes, randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { PoolConnection, ResultSetHeader } from "mysql2/promise";
import { config } from "../config.js";
import { cents, packageCommission, pesos } from "../shared/money.js";
import { requirements, saveSale, totalCents, type Sale } from "../features/orders/sales.js";
import { db } from "./connection.js";
import { buildDemoData, businessDate, demoPassword, type DemoData } from "./demo-data.js";
import { migrate } from "./migrate.js";

// Child tables first: keep FK checks enabled and DELETE transactional (TRUNCATE commits).
const resetTables = [
  "delivery_latest_positions", "delivery_location_sessions", "delivery_active_jobs",
  "delivery_attempts", "delivery_issues", "delivery_completions", "delivery_photos",
  "agent_rewards", "agent_targets", "automation_runs", "domain_events",
  "automation_episodes", "worker_heartbeats", "staff_notifications", "campaign_runs",
  "customer_auth_tokens", "customer_accounts", "customer_order_requests", "order_followups", "order_reviews",
  "import_rows", "commissions", "delivery_events", "inventory_movements", "order_events",
  "order_items", "order_packages", "orders", "import_batches", "leads", "customers",
  "package_items", "packages", "products", "categories", "campaigns", "users",
] as const;

async function insert(c: PoolConnection, sql: string, values: any[]) {
  const [r] = await c.execute<ResultSetHeader>(sql, values);
  return Number(r.insertId);
}

async function assertEmpty(c: Pick<PoolConnection, "query">) {
  const [tables] = await c.query<any[]>("SELECT table_name name FROM information_schema.tables WHERE table_schema=DATABASE()");
  const existing = new Set(tables.map(table => table.name));
  for (const table of resetTables) {
    if (!existing.has(table)) continue;
    const filter = table === "users" ? " WHERE email<>'historical-import@tnl.local'" : table === "categories" ? " WHERE name<>'Uncategorized'" : "";
    const [rows] = await c.query<any[]>(`SELECT 1 FROM ${table}${filter} LIMIT 1`);
    if (rows.length) throw new Error(`Database already contains ${table}. Use the explicit db:reset command to replace it.`);
  }
}

export function seedOptions(args: string[], environment: string, database: string) {
  if (environment === "production") throw new Error("Demo seed/reset is disabled in production.");
  const reset = args.includes("--reset");
  const confirmation = args.find(arg => arg.startsWith("--confirm="));
  if (args.some(arg => arg !== "--reset" && arg !== "--check" && !arg.startsWith("--confirm=")))
    throw new Error("Usage: db:seed [--check] or db:reset -- --confirm=<DB_NAME>");
  if (reset && confirmation !== `--confirm=${database}`)
    throw new Error(`Reset replaces ALL application records in ${database}. Run npm run db:reset -- --confirm=${database}`);
  if (!reset && confirmation) throw new Error("--confirm is only valid with db:reset.");
  return { reset, check: args.includes("--check") };
}

export async function seedDefenseData(data: DemoData, reset = false) {
  const passwordHash = await bcrypt.hash(demoPassword, 12);
  const c = await db.getConnection();
  try {
    await c.beginTransaction();
    if (reset) {
      for (const table of resetTables) await c.query(`DELETE FROM ${table}`);
    } else await assertEmpty(c);
    await c.query("UPDATE automation_settings SET enabled=FALSE");
    await c.query("INSERT IGNORE INTO categories(name,description) VALUES('Uncategorized','Products created automatically from historical data imports')");
    await c.query("INSERT IGNORE INTO users(email,password_hash,full_name,role,commission_rate,active) VALUES('historical-import@tnl.local','!','Store (Historical Import)','ADMIN',0,FALSE)");
    const userIds = new Map<number, number>(), customerIds = new Map<number, number>();
    const productIds = new Map<number, number>(), packageIds = new Map<number, number>();
    const orderIds = new Map<number, number>(), categoryIds = new Map<string, number>();
    for (const u of data.users) userIds.set(u.id, await insert(c,
      "INSERT INTO users(email,phone,password_hash,full_name,role,commission_rate,created_at,updated_at) VALUES(?,?,?,?,?,0,?,?)",
      [u.email, `0918${String(5550100 + u.id)}`, passwordHash, u.name, u.role, u.createdAt, u.createdAt]));
    const adminId = userIds.get(1)!;
    const catalogCreatedAt = new Date(data.start.getTime() - 30 * 86400000);
    for (const p of data.products) {
      if (!categoryIds.has(p.category)) categoryIds.set(p.category, await insert(c,
        "INSERT INTO categories(name,description,created_at) VALUES(?,?,?)",
        [p.category, `IT and mobile retail: ${p.category.toLowerCase()}.`, catalogCreatedAt]));
      const inventory = data.inventory.find(i => i.productId === p.id)!;
      const productId = await insert(c,
        "INSERT INTO products(category_id,name,sku,price,description,stock_on_hand,stock_reserved,low_stock_threshold,reorder_level,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
        [categoryIds.get(p.category), p.name, p.sku, p.price, p.description, inventory.onHand, inventory.reserved, p.threshold, p.reorder, catalogCreatedAt, data.now]);
      productIds.set(p.id, productId);
      await insert(c, "INSERT INTO inventory_movements(product_id,actor_id,type,quantity,note,created_at) VALUES(?,?,'ADD',?,?,?)",
        [productId, adminId, inventory.opening, "Opening warehouse balance and supplier receipts for the demonstration period.", new Date(data.start.getTime() - 14 * 86400000)]);
    }
    const mapSale = (s: Sale): Sale => ({
      items: s.items.map(i => ({ ...i, productId: productIds.get(i.productId)! })),
      packages: s.packages.map(p => ({ ...p, packageId: packageIds.get(p.packageId)!, components: p.components.map(i => ({ ...i, productId: productIds.get(i.productId)! })) })),
    });
    for (const p of data.packages) {
      const id = await insert(c, "INSERT INTO packages(name,description,selling_price,commission_type,commission_value,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",
        [p.name, p.description, p.sellingPrice, p.commissionType, p.commissionValue, catalogCreatedAt, catalogCreatedAt]);
      packageIds.set(p.packageId, id);
      for (const part of p.components) await insert(c, "INSERT INTO package_items(package_id,product_id,quantity) VALUES(?,?,?)", [id, productIds.get(part.productId), part.quantity]);
    }
    for (const customer of data.customers) {
      const id = await insert(c,
        "INSERT INTO customers(full_name,email,phone,address,assigned_agent_id,marketing_opt_in,marketing_opted_at,unsubscribe_token,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
        [customer.name, customer.email, customer.phone, customer.address, customer.agentId ? userIds.get(customer.agentId) : null, customer.optedIn, customer.optedIn ? customer.createdAt : null, randomBytes(32).toString("hex"), customer.createdAt, customer.createdAt]);
      customerIds.set(customer.id, id);
      await insert(c, "INSERT INTO customer_accounts(customer_id,password_hash,verified_at) VALUES(?,?,?)", [id, passwordHash, customer.createdAt]);
    }
    const orderEvent = async (id: number, actor: number, type: string, message: string, at: Date) => {
      await insert(c, "INSERT INTO order_events(order_id,actor_id,type,message,created_at) VALUES(?,?,?,?,?)", [id, actor, type, message, at]);
    };
    for (const o of data.orders) {
      const customer = data.customers[o.customerId - 1]!;
      const s = mapSale(o.sale), total = totalCents(s);
      const cashReceived = o.paymentMethod !== "Cash" ? null : o.paymentStatus === "UNPAID" ? 0 : o.paymentStatus === "PARTIALLY_PAID" ? pesos(Math.floor(total / 2)) : Math.ceil(pesos(total) / 100) * 100;
      const id = await insert(c,
        `INSERT INTO orders(tracking_number,customer_id,agent_id,delivery_employee_id,delivery_assignment_version,destination_latitude,destination_longitude,delivery_address,payment_method,payment_status,cash_received,cash_change,order_status,delivery_status,origin,sales_version,approved_at,delivery_changed_at,sale_completed_at,created_at,updated_at)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,'LIVE','PACKAGE',?,?,?,?,?)`,
        [o.trackingNumber, customerIds.get(o.customerId), o.agentId ? userIds.get(o.agentId) : null, o.employeeId ? userIds.get(o.employeeId) : null, o.employeeId ? 1 : 0, o.approvedAt ? customer.latitude : null, o.approvedAt ? customer.longitude : null, customer.address, o.paymentMethod, o.paymentStatus, cashReceived, cashReceived === null ? null : pesos(Math.max(0, cents(cashReceived) - total)), o.orderStatus, o.deliveryStatus, o.approvedAt, o.deliveryChangedAt, o.saleCompletedAt, o.createdAt, o.updatedAt]);
      orderIds.set(o.id, id);
      await saveSale(c, id, s);
      // Staff product/mixed orders come from the office; agents may select packages only.
      await orderEvent(id, s.items.length ? adminId : o.agentId ? userIds.get(o.agentId)! : adminId, "CREATED", `Order created totaling ₱${pesos(total).toFixed(2)}.`, o.createdAt);
      if (o.approvedAt) {
        await orderEvent(id, adminId, "APPROVED", "Catalog terms confirmed and component stock reserved.", o.approvedAt);
        for (const item of requirements(s)) {
          await insert(c, "INSERT INTO inventory_movements(product_id,actor_id,type,quantity,order_id,created_at) VALUES(?,?,'RESERVE',?,?,?)", [item.productId, adminId, item.quantity, id, o.approvedAt]);
          if (o.deliveryStatus === "DELIVERED") await insert(c, "INSERT INTO inventory_movements(product_id,actor_id,type,quantity,order_id,created_at) VALUES(?,?,'DEDUCT',?,?,?)", [item.productId, adminId, item.quantity, id, o.deliveryChangedAt]);
        }
        const stages = ["PREPARING", "DISPATCHED", "IN_TRANSIT", "OUT_FOR_DELIVERY", "DELIVERED"];
        const lastStage = stages.indexOf(o.deliveryStatus!);
        for (let i = 0; i <= lastStage; i++) {
          const at = new Date(o.approvedAt.getTime() + (o.deliveryChangedAt!.getTime() - o.approvedAt.getTime()) * (lastStage === 0 ? 0 : i / lastStage));
          await insert(c, "INSERT INTO delivery_events(order_id,status,notes,latitude,longitude,occurred_at) VALUES(?,?,?,?,?,?)",
            [id, stages[i], ["Packing and checking serial labels.", "Released to the assigned delivery employee.", "Traveling to the delivery area.", "Recipient contacted for handover.", "Recipient handover recorded by the office."][i], i >= 3 ? customer.latitude : null, i >= 3 ? customer.longitude : null, at]);
        }
        if (o.employeeId) await orderEvent(id, adminId, "DELIVERY_ASSIGNED", `Assigned to ${data.users.find(u => u.id === o.employeeId)!.name}.`, o.approvedAt);
        if (o.deliveryStatus === "DELIVERED") {
          const exception = "Defense sample: historical handover entered by the admin; no real recipient photo is represented.";
          await insert(c, "INSERT INTO delivery_completions(order_id,recipient_name,actor_id,completed_at,exception_reason) VALUES(?,?,?,?,?)", [id, customer.name, adminId, o.deliveryChangedAt, exception]);
          await orderEvent(id, adminId, "DELIVERY_PROOF_EXCEPTION", exception, o.deliveryChangedAt!);
          await orderEvent(id, adminId, "DELIVERY_UPDATED", "Delivery advanced to DELIVERED.", o.deliveryChangedAt!);
        }
      }
      if (o.orderStatus === "CANCELLED" || o.orderStatus === "REJECTED") await orderEvent(id, adminId, o.orderStatus, o.orderStatus === "CANCELLED" ? "Customer postponed the purchase before approval; no stock was reserved." : "Requested configuration did not meet the customer's needs; revised quote offered.", o.updatedAt);
      if (o.paymentStatus !== "UNPAID") await orderEvent(id, adminId, "PAYMENT_UPDATED", `Office recorded ${o.paymentStatus === "PAID" ? "full payment" : "a deposit; remaining balance is outstanding"}.`, o.updatedAt);
      if (o.saleCompletedAt && o.agentId && s.packages.length) {
        const breakdown = s.packages.map(p => ({ packageId: p.packageId, name: p.name, quantity: p.quantity, commissionType: p.commissionType, commissionValue: p.commissionValue, amount: pesos(packageCommission(p)) }));
        await insert(c, "INSERT INTO commissions(order_id,agent_id,rate,amount,breakdown,source,created_at) VALUES(?,?,NULL,?,?,'PACKAGE',?)", [id, userIds.get(o.agentId), pesos(breakdown.reduce((sum, p) => sum + cents(p.amount), 0)), JSON.stringify(breakdown), o.saleCompletedAt]);
      }
    }
    const reviewComments = [
      "Follow-ups were slow and I had to contact the office repeatedly for a delivery update.",
      "The package was correct, but my agent did not clearly explain the delivery arrangements.",
      "The products work well. Updates about the schedule could have been more consistent.",
      "My agent explained the package clearly and helped coordinate the delivery with the office.",
      "Helpful recommendations, prompt replies, and all package accessories arrived as discussed.",
    ];
    for (const [i, o] of data.orders.filter(o => o.saleCompletedAt).entries()) {
      if (i % 3 !== 0) continue;
      const rating = [5, 4, 5, 3, 4, 5, 2, 5, 4, 1][Math.floor(i / 3) % 10]!;
      await insert(c, "INSERT INTO order_reviews(order_id,customer_id,agent_id,rating,review,created_at) VALUES(?,?,?,?,?,?)",
        [orderIds.get(o.id), customerIds.get(o.customerId), o.agentId ? userIds.get(o.agentId) : null, rating,
          o.agentId ? reviewComments[rating - 1] : reviewComments[rating - 1]!.replaceAll("my agent", "the office").replaceAll("My agent", "The office"),
          new Date(Math.min(data.now.getTime(), o.saleCompletedAt!.getTime() + 6 * 3600000))]);
    }
    // One active job per employee; location sharing requires a real browser session.
    for (const employeeId of [10, 11]) {
      const o = data.orders.find(o => o.employeeId === employeeId && o.deliveryStatus === "OUT_FOR_DELIVERY")!;
      const attempt = randomUUID();
      await insert(c, "INSERT INTO delivery_attempts(id,order_id,employee_id,assignment_version,started_at) VALUES(?,?,?,1,?)", [attempt, orderIds.get(o.id), userIds.get(employeeId), o.approvedAt]);
      await insert(c, "INSERT INTO delivery_active_jobs(employee_id,order_id,attempt_id) VALUES(?,?,?)", [userIds.get(employeeId), orderIds.get(o.id), attempt]);
    }
    const openDeliveries = data.orders.filter(o => o.orderStatus === "APPROVED" && o.employeeId);
    for (let i = 0; i < 4; i++) {
      const o = openDeliveries[i * 3]!;
      await insert(c, "INSERT INTO delivery_issues(order_id,employee_id,explanation,created_at,resolved_by,resolved_at,resolution) VALUES(?,?,?,?,?,?,?)", [orderIds.get(o.id), userIds.get(o.employeeId!), ["Recipient unavailable; requested an afternoon delivery slot.", "Building security requires the recipient's gate authorization.", "Address landmark needs confirmation before dispatch.", "Heavy rain delayed the scheduled handover."][i], o.approvedAt, i < 2 ? null : adminId, i < 2 ? null : o.updatedAt, i < 2 ? null : "Recipient confirmed the updated delivery instructions with the office."]);
    }
    for (const target of data.targets) {
      const at = new Date(`${target.period}-01T00:00:00+08:00`);
      const id = await insert(c, "INSERT INTO agent_targets(agent_id,period,sales_target,incentive_amount,updated_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?)", [userIds.get(target.agentId), target.period, target.salesTarget, target.incentive, adminId, at, at]);
      const sales = data.orders.filter(o => o.agentId === target.agentId && o.saleCompletedAt && businessDate(o.saleCompletedAt).startsWith(target.period));
      const approvedAt = sales.at(-1)?.saleCompletedAt ?? at;
      if (target.approved) await insert(c, "INSERT INTO agent_rewards(agent_id,period,kind,target_id,amount,reason,approved_by,idempotency_key,created_at) VALUES(?,?,'INCENTIVE',?,?,?,?,?,?)", [userIds.get(target.agentId), target.period, id, target.incentive, `Monthly sales target of ₱${target.salesTarget.toLocaleString("en-PH")} achieved; fixed incentive approved.`, adminId, `demo-incentive-${target.agentId}-${target.period}`, approvedAt]);
      if (target.agentId === 2 || target.agentId === 3) await insert(c, "INSERT INTO agent_rewards(agent_id,period,kind,amount,reason,approved_by,idempotency_key,created_at) VALUES(?,?,'BONUS',?,?,?,?,?)", [userIds.get(target.agentId), target.period, target.agentId === 2 ? 1250 : 750, target.agentId === 2 ? "Repeat-business referrals and complete customer handover records." : "Prompt follow-up replies and coordinated small-business installations.", adminId, `demo-bonus-${target.agentId}-${target.period}`, approvedAt]);
    }
    // Submitted requests reserve nothing; converted snapshots match their linked orders.
    const converted = data.orders.filter(o => o.sale.packages.length && !o.sale.items.length && o.paymentMethod !== "Cash").slice(-8);
    for (let i = 0; i < 24; i++) {
      const o = i < 8 ? converted[i]! : data.orders[312 + (i - 8)]!;
      const customer = data.customers[o.customerId - 1]!;
      const status = i < 8 ? "CONVERTED" : i < 20 ? "SUBMITTED" : "DECLINED";
      await insert(c, "INSERT INTO customer_order_requests(customer_id,agent_id,status,snapshot,delivery_address,payment_method,order_id,decline_reason,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)", [customerIds.get(o.customerId), o.agentId ? userIds.get(o.agentId) : null, status, JSON.stringify(mapSale(o.sale)), customer.address, o.paymentMethod === "Cash" ? "Cash on delivery" : o.paymentMethod, status === "CONVERTED" ? orderIds.get(o.id) : null, status === "DECLINED" ? "Customer requested a different configuration; please submit the revised package." : null, new Date(Math.max(customer.createdAt.getTime(), o.createdAt.getTime() - 3600000)), o.updatedAt]);
    }
    const followupOrders = data.orders.filter(o => o.agentId && o.orderStatus === "APPROVED").slice(0, 16);
    for (let i = 0; i < followupOrders.length; i++) {
      const o = followupOrders[i]!;
      await insert(c, "INSERT INTO order_followups(order_id,customer_id,message,reply,replied_by,replied_at,created_at) VALUES(?,?,?,?,?,?,?)", [orderIds.get(o.id), customerIds.get(o.customerId), i % 2 ? "Please confirm the delivery window so someone can receive the items." : "Could you confirm that all package accessories will be included?", i < 8 ? "Your package is reserved and being prepared. I will confirm the delivery slot with the office." : null, i < 8 ? userIds.get(o.agentId!) : null, i < 8 ? o.updatedAt : null, new Date(o.updatedAt.getTime() - 3600000)]);
    }
    const leadNames = ["Francis Ocampo", "Mary Ann Vergara", "Joseph Chua", "Elaine Padilla", "Patrick Sison", "Melanie Rosales", "Gerard Ibarra", "Therese David", "Bryan Angeles", "Catherine Sy", "Jasper Nolasco", "Michelle Estrada", "Vincent Alonzo", "Leah Robles", "Oscar Fuentes", "Irene Santiago"];
    for (let i = 0; i < 24; i++) {
      const convertedLead = i < 8 ? data.customers[i]! : null;
      const name = convertedLead?.name ?? leadNames[i - 8]!;
      const agent = data.users.find(u => u.id === (convertedLead?.agentId ?? 2 + i % 8))!;
      const at = convertedLead ? new Date(convertedLead.createdAt.getTime() - 3 * 86400000) : new Date(Math.max(agent.createdAt.getTime(), data.now.getTime() - (i - 7) * 86400000));
      await insert(c, "INSERT INTO leads(full_name,email,phone,source,assigned_agent_id,status,converted_customer_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)", [name, convertedLead?.email ?? `${name.toLowerCase().replaceAll(" ", ".")}@example.test`, convertedLead?.phone ?? `0919${String(5550100 + i)}`, ["Facebook inquiry", "Customer referral", "Store walk-in", "School / office referral"][i % 4], userIds.get(convertedLead?.agentId ?? 2 + i % 8), convertedLead ? "CONVERTED" : ["NEW", "CONTACTED", "QUALIFIED", "LOST"][i % 4], convertedLead ? customerIds.get(convertedLead.id) : null, at, convertedLead?.createdAt ?? at]);
    }
    const campaignNames = ["Student Laptop Enquiries", "Home Wi-Fi Consultation Week", "Small Business Hardware Follow-up", "Home Office Package Preview"];
    for (let i = 0; i < campaignNames.length; i++) {
      const at = new Date(data.now.getTime() + (i === 1 ? 2 : -7) * 86400000);
      const selected = data.customers.filter(c => c.optedIn).slice(0, 6).map(c => customerIds.get(c.id)!);
      const id = await insert(c, "INSERT INTO campaigns(name,target_audience,content,start_date,end_date,status,audience_type,customer_ids,scheduled_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)", [campaignNames[i], i % 2 ? "Selected opted-in customers" : "All eligible customers", "Explore our IT and mobile packages. Ask your assigned TNL field agent about current availability and a suitable configuration. No online payment is collected.", businessDate(at), businessDate(new Date(at.getTime() + 14 * 86400000)), ["COMPLETED", "SCHEDULED", "COMPLETED", "DRAFT"][i], i % 2 ? "SELECTED" : "ALL", JSON.stringify(i % 2 ? selected : []), i === 1 ? at : null, new Date(at.getTime() - (i === 1 ? 3 : 1) * 86400000), i === 1 ? new Date(at.getTime() - 3 * 86400000) : at]);
      if (i % 2 === 0) {
        const recipients = data.customers.filter(c => c.optedIn && c.createdAt <= at);
        await insert(c, "INSERT INTO campaign_runs(campaign_id,recipient_count,content_snapshot,created_at) VALUES(?,?,?,?)", [id, recipients.length, JSON.stringify({ name: campaignNames[i], content: "Demonstration campaign history; no messages sent by the seed." }), at]);
        for (const [index, customer] of recipients.entries()) await insert(c,
          "INSERT INTO automation_runs(workflow,dedupe_key,state,payload,available_at,attempts,result,created_at,updated_at) VALUES('CAMPAIGN_SEND',?,?,?,?,1,?,?,?)",
          [`campaign:${id}:customer:${customerIds.get(customer.id)}`, index % 5 === 0 ? "SKIPPED" : "ACCEPTED", JSON.stringify({ kind: "EMAIL", marketing: true, campaignId: id, customerId: customerIds.get(customer.id), subject: campaignNames[i], content: "Demonstration history only." }), at, JSON.stringify(index % 5 === 0 ? { reason: "Customer opted out before dispatch (demo)." } : { accepted: true, demo: true }), at, at]);
      }
    }
    for (const [i, state] of ["SUCCEEDED", "FAILED", "UNKNOWN", "SKIPPED"].entries()) await insert(c,
      "INSERT INTO automation_runs(workflow,dedupe_key,state,payload,available_at,attempts,result,last_error,created_at,updated_at) VALUES('PENDING_APPROVAL',?,?,?,?,1,?,?,?,?)",
      [`demo-history-${i}`, state, JSON.stringify({ kind: "STAFF", title: "Pending approval reminder", message: "Demonstration history only.", link: "/orders" }), data.now, JSON.stringify({ demo: true }), state === "FAILED" ? "Demo: temporary database connection failure during reminder processing." : state === "UNKNOWN" ? "Demo: prior worker stopped before its result was recorded." : null, data.now, data.now]);
    const batch = await insert(c, "INSERT INTO import_batches(file_name,uploaded_by,status,total_rows,ready_rows,attention_rows,created_at) VALUES(?,?,'NEEDS_REVIEW',4,2,2,?)", ["tnl-store-sales-review-demo.xlsx", adminId, data.now]);
    for (let i = 0; i < 4; i++) await insert(c, "INSERT INTO import_rows(batch_id,sheet_name,section,row_no,order_date,raw_customer_name,raw_product_name,unit_price,cash_received,payment_status,payment_method,customer_id,product_id,status,issue) VALUES(?,'Store Sales','STORE_SALES',?,?,?,?,?,?,'PAID','Cash',?,?,?,?)", [batch, i + 2, businessDate(new Date(data.start.getTime() - 20 * 86400000)), data.customers[i]!.name, i < 2 ? data.products[i]!.name : "Laptop configuration missing", data.products[i]!.price, data.products[i]!.price, customerIds.get(i + 1), i < 2 ? productIds.get(i + 1) : null, i < 2 ? "READY" : "NEEDS_ATTENTION", i < 2 ? null : "Match the original laptop configuration before confirming the import."]);
    const notify = async (user: number, key: string, title: string, message: string, link: string) => insert(c, "INSERT INTO staff_notifications(user_id,dedupe_key,type,title,message,link,created_at) VALUES(?,?,'DEMO',?,?,?,?)", [userIds.get(user), key, title, message, link, data.now]);
    for (const p of data.products.filter(p => p.available <= p.threshold)) await notify(1, `demo-stock-${p.id}`, "Low available stock", `${p.name}: ${p.available} available; reorder level ${p.reorder}.`, "/inventory");
    for (const o of data.orders.filter(o => o.orderStatus === "PENDING").slice(0, 8)) {
      await notify(1, `demo-approval-${o.id}`, "Order awaiting approval", `${o.trackingNumber} needs an admin decision.`, `/orders/${orderIds.get(o.id)}`);
      if (o.agentId) await notify(o.agentId, `demo-order-${o.id}`, "Order assigned", `${o.trackingNumber} · ${data.customers[o.customerId - 1]!.name}`, `/orders/${orderIds.get(o.id)}`);
    }
    for (const employeeId of [10, 11]) await notify(employeeId, `demo-dispatch-${employeeId}`, "Deliveries assigned", "Review your assigned delivery queue and active handover.", "/delivery");
    await c.commit();
    return { products: data.products.length, packages: data.packages.length, agents: 8, deliveryStaff: 2, customers: data.customers.length, orders: data.orders.length, periods: data.periods };
  } catch (error) {
    await c.rollback();
    throw error;
  } finally {
    c.release();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = seedOptions(process.argv.slice(2), config.NODE_ENV, config.DB_NAME);
    const data = buildDemoData();
    if (options.check) {
      console.log(`Defense dataset preview (no database writes): ${data.products.length} products, ${data.packages.length} packages, 8 agents, 2 delivery staff, ${data.customers.length} customers, ${data.orders.length} orders.`);
      console.log(`Report months: ${data.periods.join(", ")}`);
    } else {
      if (!options.reset) await assertEmpty(db);
      await migrate();
      console.log(`Loading defense data into ${config.DB_HOST}:${config.DB_PORT}/${config.DB_NAME}...`);
      console.log(await seedDefenseData(data, options.reset));
      console.log("Staff: admin@tnl.local; agent@tnl.local; agent2@tnl.local through agent8@tnl.local; delivery1@tnl.local and delivery2@tnl.local.");
      console.log(`Customer portal: mara.santos@example.test. Password for all demo accounts: ${demoPassword}`);
      console.log("Automations are disabled. No email was sent or queued; historical execution results are labeled demo.");
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  } finally {
    await db.end();
  }
}
