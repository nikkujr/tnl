import { randomInt } from "node:crypto";
import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { db } from "../../database/connection.js";
import { authenticate, authorize } from "../../shared/auth.js";
import { HttpError, validate } from "../../shared/http.js";
import { parseSalesReport, ParsedRow } from "./sales-report-parser.js";

const router = Router();
router.use(authenticate, authorize("ADMIN"));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const isXlsx = file.mimetype === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" || file.originalname.toLowerCase().endsWith(".xlsx");
    if (!isXlsx) return cb(new HttpError(400, "Only .xlsx files are supported"));
    cb(null, true);
  }
});

const TRACKING_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function randomTrackingSegment(length: number): string {
  return Array.from({ length }, () => TRACKING_CHARS[randomInt(TRACKING_CHARS.length)]).join("");
}
function generateTrackingNumber(): string {
  return `TNL-${randomTrackingSegment(6)}-${randomTrackingSegment(4)}`;
}

function normalizeName(value: string): string {
  return value.trim().toUpperCase().replace(/\s+/g, " ");
}

async function ensureSystemAgentId(connection: any): Promise<number> {
  await connection.execute(
    `INSERT INTO users(email,password_hash,full_name,role,commission_rate,active)
     VALUES('historical-import@tnl.local','!','Store (Historical Import)','ADMIN',0,FALSE)
     ON DUPLICATE KEY UPDATE full_name=VALUES(full_name)`
  );
  const [rows]: any = await connection.query("SELECT id FROM users WHERE email='historical-import@tnl.local'");
  return rows[0].id as number;
}

async function ensureUncategorizedCategoryId(connection: any): Promise<number> {
  await connection.execute(
    `INSERT INTO categories(name,description) VALUES('Uncategorized','Products created automatically from historical data imports')
     ON DUPLICATE KEY UPDATE name=VALUES(name)`
  );
  const [rows]: any = await connection.query("SELECT id FROM categories WHERE name='Uncategorized'");
  return rows[0].id as number;
}

interface ResolvedRow extends ParsedRow {
  customerId: number | null;
  newCustomerName: string | null;
  productId: number | null;
  newProductName: string | null;
  agentId: number;
  status: "READY" | "NEEDS_ATTENTION";
}

router.post("/sales-report", upload.single("file"), async (req, res, next) => {
  try {
    if (!req.file) throw new HttpError(400, "No file uploaded");
    const { rows, skippedSheets } = await parseSalesReport(req.file.buffer);
    if (!rows.length) throw new HttpError(400, "No recognizable sales rows were found in this file");

    const [customerRows] = await db.query<any[]>("SELECT id,full_name FROM customers");
    const [productRows] = await db.query<any[]>("SELECT id,name FROM products WHERE active=TRUE");
    const [agentRows] = await db.query<any[]>("SELECT id,full_name FROM users WHERE role IN ('ADMIN','AGENT') AND active=TRUE");
    const systemAgentId = await ensureSystemAgentId(db);

    const customerMap = new Map<string, number>(customerRows.map((row) => [normalizeName(row.full_name), row.id]));
    const productMap = new Map<string, number>(productRows.map((row) => [normalizeName(row.name), row.id]));
    const agentMap = new Map<string, number>(agentRows.map((row) => [normalizeName(row.full_name), row.id]));

    const resolved: ResolvedRow[] = rows.map((row) => {
      let customerId: number | null = null;
      let newCustomerName: string | null = null;
      let productId: number | null = null;
      let newProductName: string | null = null;

      if (row.customerName) {
        const key = normalizeName(row.customerName);
        customerId = customerMap.get(key) ?? null;
        if (customerId === null) newCustomerName = row.customerName;
      }
      if (row.productName) {
        const key = normalizeName(row.productName);
        productId = productMap.get(key) ?? null;
        if (productId === null) newProductName = row.productName;
      }

      let agentId = systemAgentId;
      if (row.agentName && normalizeName(row.agentName) !== "STORE") {
        agentId = agentMap.get(normalizeName(row.agentName)) ?? systemAgentId;
      }

      const status: "READY" | "NEEDS_ATTENTION" = row.issue ? "NEEDS_ATTENTION" : "READY";
      return { ...row, customerId, newCustomerName, productId, newProductName, agentId, status };
    });

    const [batchResult] = await db.execute<any>(
      "INSERT INTO import_batches(file_name,uploaded_by,status,total_rows) VALUES(?,?,?,?)",
      [req.file.originalname, req.user!.id, "PROCESSING", resolved.length]
    );
    const batchId = batchResult.insertId as number;

    const chunkSize = 200;
    for (let start = 0; start < resolved.length; start += chunkSize) {
      const chunk = resolved.slice(start, start + chunkSize);
      const placeholders = chunk.map(() => "(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").join(",");
      const values = chunk.flatMap((row) => [
        batchId, row.sheetName, row.section, row.rowNumber, row.orderDate,
        row.customerName, row.productName, row.agentName, row.imei, row.note, row.orNo,
        row.unitPrice, row.cashReceived, row.paymentStatus, row.paymentMethod,
        row.customerId, row.newCustomerName, row.productId, row.newProductName,
        row.agentId, row.status, row.issue
      ]);
      await db.query(
        `INSERT INTO import_rows(batch_id,sheet_name,section,row_no,order_date,raw_customer_name,raw_product_name,raw_agent_name,raw_imei,raw_note,raw_or_no,unit_price,cash_received,payment_status,payment_method,customer_id,new_customer_name,product_id,new_product_name,agent_id,status,issue) VALUES ${placeholders}`,
        values
      );
    }

    const readyCount = resolved.filter((row) => row.status === "READY").length;
    const attentionCount = resolved.length - readyCount;
    await db.execute("UPDATE import_batches SET status='NEEDS_REVIEW',ready_rows=?,attention_rows=? WHERE id=?", [readyCount, attentionCount, batchId]);

    res.status(201).json({
      data: {
        batchId,
        totalRows: resolved.length,
        readyRows: readyCount,
        attentionRows: attentionCount,
        skippedSheets
      }
    });
  } catch (error) { next(error); }
});

router.get("/meta/agents", async (_req, res, next) => {
  try {
    const [rows] = await db.query<any[]>(
      `SELECT id,full_name fullName,email FROM users
       WHERE role IN ('ADMIN','AGENT') AND (active=TRUE OR email='historical-import@tnl.local')
       ORDER BY email='historical-import@tnl.local' DESC, full_name`
    );
    res.json({ data: rows });
  } catch (error) { next(error); }
});

router.get("/", async (_req, res, next) => {
  try {
    const [rows] = await db.query<any[]>(
      `SELECT id,file_name fileName,status,total_rows totalRows,ready_rows readyRows,attention_rows attentionRows,created_at createdAt,confirmed_at confirmedAt
       FROM import_batches ORDER BY created_at DESC LIMIT 50`
    );
    res.json({ data: rows });
  } catch (error) { next(error); }
});

const batchParams = z.object({ body: z.any(), query: z.any(), params: z.object({ batchId: z.coerce.number().int().positive() }) });

router.get("/:batchId", validate(batchParams), async (req, res, next) => {
  try {
    const batchId = Number(req.params.batchId);
    const [batches] = await db.query<any[]>(
      `SELECT id,file_name fileName,status,total_rows totalRows,ready_rows readyRows,attention_rows attentionRows,created_at createdAt,confirmed_at confirmedAt
       FROM import_batches WHERE id=?`,
      [batchId]
    );
    const batch = batches[0];
    if (!batch) throw new HttpError(404, "Import batch not found");
    const [counts] = await db.query<any[]>(
      `SELECT status, COUNT(*) count FROM import_rows WHERE batch_id=? GROUP BY status`,
      [batchId]
    );
    const liveCounts = { READY: 0, NEEDS_ATTENTION: 0, SKIPPED: 0 } as Record<string, number>;
    for (const row of counts) liveCounts[row.status] = row.count;
    res.json({ data: { ...batch, liveCounts } });
  } catch (error) { next(error); }
});

router.get("/:batchId/rows", validate(z.object({
  body: z.any(),
  query: z.object({
    section: z.enum(["STORE_SALES", "HOME_CREDIT", "CI_AGENT", "CI_PAYMENT"]).optional(),
    status: z.enum(["READY", "NEEDS_ATTENTION", "SKIPPED"]).optional(),
    page: z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().positive().max(200).optional()
  }),
  params: z.object({ batchId: z.coerce.number().int().positive() })
})), async (req, res, next) => {
  try {
    const batchId = Number(req.params.batchId);
    const page = req.query.page ? Number(req.query.page) : 1;
    const limit = req.query.limit ? Number(req.query.limit) : 50;
    const offset = (page - 1) * limit;
    const filters: string[] = ["ir.batch_id=?"];
    const args: unknown[] = [batchId];
    if (req.query.section) { filters.push("ir.section=?"); args.push(req.query.section); }
    if (req.query.status) { filters.push("ir.status=?"); args.push(req.query.status); }
    const where = filters.join(" AND ");
    const [rows] = await db.query<any[]>(
      `SELECT ir.id,ir.sheet_name sheetName,ir.section,ir.row_no rowNumber,DATE_FORMAT(ir.order_date,'%Y-%m-%d') orderDate,
       ir.raw_customer_name rawCustomerName,ir.raw_product_name rawProductName,ir.raw_agent_name rawAgentName,
       ir.raw_imei rawImei,ir.raw_note rawNote,ir.raw_or_no rawOrNo,
       ir.unit_price unitPrice,ir.cash_received cashReceived,ir.payment_status paymentStatus,ir.payment_method paymentMethod,
       ir.customer_id customerId,c.full_name customerName,ir.new_customer_name newCustomerName,
       ir.product_id productId,p.name productName,ir.new_product_name newProductName,
       ir.agent_id agentId,u.full_name agentName,ir.status,ir.issue,ir.created_order_id createdOrderId
       FROM import_rows ir
       LEFT JOIN customers c ON c.id=ir.customer_id
       LEFT JOIN products p ON p.id=ir.product_id
       LEFT JOIN users u ON u.id=ir.agent_id
       WHERE ${where} ORDER BY ir.order_date,ir.id LIMIT ? OFFSET ?`,
      [...args, limit, offset]
    );
    const [counts] = await db.query<any[]>(`SELECT COUNT(*) total FROM import_rows ir WHERE ${where}`, args);
    res.json({ data: rows, meta: { page, limit, total: counts[0].total } });
  } catch (error) { next(error); }
});

const patchRowBody = z.object({
  customerId: z.number().int().positive().nullable().optional(),
  newCustomerName: z.string().trim().min(1).max(160).nullable().optional(),
  productId: z.number().int().positive().nullable().optional(),
  newProductName: z.string().trim().min(1).max(180).nullable().optional(),
  agentId: z.number().int().positive().optional(),
  unitPrice: z.number().positive().optional(),
  cashReceived: z.number().min(0).nullable().optional(),
  paymentStatus: z.enum(["PAID", "PARTIALLY_PAID"]).optional(),
  paymentMethod: z.string().trim().min(1).max(80).optional(),
  orderDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  skipped: z.boolean().optional()
});

router.patch("/:batchId/rows/:rowId", validate(z.object({
  body: patchRowBody, query: z.any(),
  params: z.object({ batchId: z.coerce.number().int().positive(), rowId: z.coerce.number().int().positive() })
})), async (req, res, next) => {
  try {
    const batchId = Number(req.params.batchId);
    const rowId = Number(req.params.rowId);
    const [batches] = await db.query<any[]>("SELECT status FROM import_batches WHERE id=?", [batchId]);
    if (!batches.length) throw new HttpError(404, "Import batch not found");
    if (batches[0].status !== "NEEDS_REVIEW") throw new HttpError(409, "Only batches pending review can be edited");
    const [existingRows] = await db.query<any[]>(
      "SELECT *, DATE_FORMAT(order_date,'%Y-%m-%d') order_date_str FROM import_rows WHERE id=? AND batch_id=?",
      [rowId, batchId]
    );
    const existing = existingRows[0];
    if (!existing) throw new HttpError(404, "Import row not found");

    const body = req.body as z.infer<typeof patchRowBody>;
    const merged = {
      customerId: body.customerId !== undefined ? body.customerId : existing.customer_id,
      newCustomerName: body.customerId !== undefined ? null : body.newCustomerName !== undefined ? body.newCustomerName : existing.new_customer_name,
      productId: body.productId !== undefined ? body.productId : existing.product_id,
      newProductName: body.productId !== undefined ? null : body.newProductName !== undefined ? body.newProductName : existing.new_product_name,
      agentId: body.agentId ?? existing.agent_id,
      unitPrice: body.unitPrice ?? existing.unit_price,
      cashReceived: body.cashReceived !== undefined ? body.cashReceived : existing.cash_received,
      paymentStatus: body.paymentStatus ?? existing.payment_status,
      paymentMethod: body.paymentMethod ?? existing.payment_method,
      orderDate: body.orderDate ?? existing.order_date_str
    };
    if (body.customerId !== undefined) merged.newCustomerName = null;
    if (body.newCustomerName !== undefined && body.newCustomerName !== null) merged.customerId = null;
    if (body.productId !== undefined) merged.newProductName = null;
    if (body.newProductName !== undefined && body.newProductName !== null) merged.productId = null;

    const hasCustomer = merged.customerId !== null || !!merged.newCustomerName;
    const hasProduct = merged.productId !== null || !!merged.newProductName;
    const hasPrice = merged.unitPrice !== null && Number(merged.unitPrice) > 0;
    const skipped = body.skipped ?? existing.status === "SKIPPED";

    let status: "READY" | "NEEDS_ATTENTION" | "SKIPPED";
    let issue: string | null = null;
    if (skipped) {
      status = "SKIPPED";
    } else if (!hasCustomer) {
      status = "NEEDS_ATTENTION"; issue = "Missing customer name";
    } else if (!hasProduct) {
      status = "NEEDS_ATTENTION"; issue = "Missing product name";
    } else if (!hasPrice) {
      status = "NEEDS_ATTENTION"; issue = "Missing sale amount";
    } else {
      status = "READY";
    }

    await db.execute(
      `UPDATE import_rows SET customer_id=?,new_customer_name=?,product_id=?,new_product_name=?,agent_id=?,unit_price=?,cash_received=?,payment_status=?,payment_method=?,order_date=?,status=?,issue=? WHERE id=?`,
      [merged.customerId, merged.newCustomerName, merged.productId, merged.newProductName, merged.agentId, merged.unitPrice, merged.cashReceived, merged.paymentStatus, merged.paymentMethod, merged.orderDate, status, issue, rowId]
    );
    const [readyCount] = await db.query<any[]>("SELECT COUNT(*) c FROM import_rows WHERE batch_id=? AND status='READY'", [batchId]);
    const [attentionCount] = await db.query<any[]>("SELECT COUNT(*) c FROM import_rows WHERE batch_id=? AND status='NEEDS_ATTENTION'", [batchId]);
    await db.execute("UPDATE import_batches SET ready_rows=?,attention_rows=? WHERE id=?", [readyCount[0].c, attentionCount[0].c, batchId]);

    res.json({ data: { id: rowId, status, issue } });
  } catch (error) { next(error); }
});

router.delete("/:batchId", validate(batchParams), async (req, res, next) => {
  try {
    const batchId = Number(req.params.batchId);
    const [batches] = await db.query<any[]>("SELECT status FROM import_batches WHERE id=?", [batchId]);
    if (!batches.length) throw new HttpError(404, "Import batch not found");
    if (batches[0].status === "CONFIRMED") throw new HttpError(409, "A confirmed import cannot be discarded");
    await db.execute("DELETE FROM import_batches WHERE id=?", [batchId]);
    res.status(204).send();
  } catch (error) { next(error); }
});

router.post("/:batchId/confirm", validate(batchParams), async (req, res, next) => {
  const connection = await db.getConnection();
  try {
    const batchId = Number(req.params.batchId);
    const [batches] = await connection.query<any[]>("SELECT status FROM import_batches WHERE id=? FOR UPDATE", [batchId]);
    if (!batches.length) throw new HttpError(404, "Import batch not found");
    if (batches[0].status !== "NEEDS_REVIEW") throw new HttpError(409, "This batch has already been confirmed, cancelled, or is still processing");

    const [attentionRows] = await connection.query<any[]>("SELECT COUNT(*) c FROM import_rows WHERE batch_id=? AND status='NEEDS_ATTENTION'", [batchId]);
    if (Number(attentionRows[0].c) > 0) throw new HttpError(409, `Resolve or skip ${attentionRows[0].c} row(s) that still need attention before confirming`);

    const [readyRows] = await connection.query<any[]>(
      "SELECT *, DATE_FORMAT(order_date,'%Y-%m-%d') order_date_str FROM import_rows WHERE batch_id=? AND status='READY' ORDER BY order_date,id",
      [batchId]
    );
    if (!readyRows.length) throw new HttpError(400, "There are no rows ready to import");

    const uncategorizedId = await ensureUncategorizedCategoryId(connection);

    await connection.beginTransaction();

    const newCustomerGroups = new Map<string, { name: string; rows: any[] }>();
    for (const row of readyRows) {
      if (row.customer_id) continue;
      const key = normalizeName(row.new_customer_name);
      if (!newCustomerGroups.has(key)) newCustomerGroups.set(key, { name: row.new_customer_name, rows: [] });
      newCustomerGroups.get(key)!.rows.push(row);
    }
    let customerGroupIndex = 0;
    for (const group of newCustomerGroups.values()) {
      customerGroupIndex++;
      const [result] = await connection.execute<any>(
        "INSERT INTO customers(full_name,email,phone,address) VALUES(?,?,?,?)",
        [group.name, `import.batch${batchId}.cust${customerGroupIndex}@placeholder.tnl.local`, "00000000000", "Address unknown — imported from historical sales report"]
      );
      for (const row of group.rows) row.customer_id = result.insertId;
    }

    const newProductGroups = new Map<string, { name: string; price: number; rows: any[] }>();
    for (const row of readyRows) {
      if (row.product_id) continue;
      const key = normalizeName(row.new_product_name);
      if (!newProductGroups.has(key)) newProductGroups.set(key, { name: row.new_product_name, price: Number(row.unit_price), rows: [] });
      newProductGroups.get(key)!.rows.push(row);
    }
    let productGroupIndex = 0;
    for (const group of newProductGroups.values()) {
      productGroupIndex++;
      const [result] = await connection.execute<any>(
        "INSERT INTO products(category_id,name,sku,price) VALUES(?,?,?,?)",
        [uncategorizedId, group.name, `IMP-${batchId}-${productGroupIndex}`, group.price]
      );
      for (const row of group.rows) row.product_id = result.insertId;
    }

    const customerIds = [...new Set(readyRows.map((row) => row.customer_id))];
    const [customerAddressRows] = await connection.query<any[]>(
      `SELECT id,address FROM customers WHERE id IN (${customerIds.map(() => "?").join(",")})`,
      customerIds
    );
    const addressById = new Map<number, string>(customerAddressRows.map((row) => [row.id, row.address]));

    const productIds = [...new Set(readyRows.map((row) => row.product_id))];
    const [productSnapshotRows] = await connection.query<any[]>(
      `SELECT id,name,sku FROM products WHERE id IN (${productIds.map(() => "?").join(",")})`,
      productIds
    );
    const productById = new Map<number, { name: string; sku: string }>(productSnapshotRows.map((row) => [row.id, { name: row.name, sku: row.sku }]));

    let ordersCreated = 0;
    for (const row of readyRows) {
      let trackingNumber = generateTrackingNumber();
      let orderResult: any;
      for (let attempt = 0; ; attempt++) {
        try {
          [orderResult] = await connection.execute<any>(
            `INSERT INTO orders(tracking_number,customer_id,agent_id,delivery_address,payment_method,payment_status,cash_received,cash_change,order_status,delivery_status,origin,import_batch_id,created_at,updated_at)
             VALUES(?,?,?,?,?,?,?,?,'COMPLETED','DELIVERED','IMPORTED',?,?,?)`,
            [
              trackingNumber, row.customer_id, row.agent_id, addressById.get(row.customer_id) ?? "Address unknown — imported from historical sales report",
              row.payment_method, row.payment_status, row.cash_received,
              row.payment_status === "PAID" ? 0 : null,
              batchId, `${row.order_date_str} 12:00:00`, `${row.order_date_str} 12:00:00`
            ]
          );
          break;
        } catch (error: any) {
          if (error?.code === "ER_DUP_ENTRY" && attempt < 4) { trackingNumber = generateTrackingNumber(); continue; }
          throw error;
        }
      }
      const orderId = orderResult.insertId;
      const product = productById.get(row.product_id)!;
      await connection.execute(
        "INSERT INTO order_items(order_id,product_id,quantity,unit_price,product_name,sku) VALUES(?,?,?,?,?,?)",
        [orderId, row.product_id, 1, row.unit_price, product.name, product.sku]
      );
      const noteParts = [`Imported from historical sales report (${row.sheet_name} · ${row.section.replaceAll("_", " ").toLowerCase()}).`];
      if (row.raw_imei) noteParts.push(`IMEI/SN: ${row.raw_imei}.`);
      if (row.raw_note) noteParts.push(`Note: ${row.raw_note}.`);
      await connection.execute(
        "INSERT INTO order_events(order_id,actor_id,type,message) VALUES(?,?,?,?)",
        [orderId, req.user!.id, "IMPORTED", noteParts.join(" ")]
      );
      await connection.execute("UPDATE import_rows SET created_order_id=? WHERE id=?", [orderId, row.id]);
      ordersCreated++;
    }

    await connection.execute("UPDATE import_batches SET status='CONFIRMED',confirmed_at=NOW() WHERE id=?", [batchId]);
    await connection.commit();
    res.json({ data: { batchId, ordersCreated, newCustomers: newCustomerGroups.size, newProducts: newProductGroups.size } });
  } catch (error) { await connection.rollback(); next(error); } finally { connection.release(); }
});

export default router;
