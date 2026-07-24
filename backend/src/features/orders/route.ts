import { randomBytes } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { db } from "../../database/connection.js";
import { authenticate, authorize } from "../../shared/auth.js";
import { HttpError, validate } from "../../shared/http.js";

const router = Router();
router.use(authenticate);

const itemSchema = z.object({
  productId: z.number().int().positive(),
  quantity: z.number().int().positive()
});
const orderBody = z.object({
  customerId: z.number().int().positive(),
  agentId: z.number().int().positive().optional(),
  items: z.array(itemSchema).min(1).max(50).refine(
    (items) => new Set(items.map((item) => item.productId)).size === items.length,
    "A product can appear only once per order"
  ),
  deliveryAddress: z.string().min(5).max(500),
  paymentMethod: z.string().min(2).max(80),
  cashReceived: z.number().min(0).nullable().optional()
});
const createSchema = z.object({ body: orderBody, query: z.any(), params: z.any() });

interface ProductRow {
  id: number;
  name: string;
  sku: string;
  price: number;
  stock_on_hand: number;
  stock_reserved: number;
}

async function loadProducts(connection: any, items: Array<{ productId: number; quantity: number }>, lock = false) {
  const ids = items.map((item) => item.productId);
  const placeholders = ids.map(() => "?").join(",");
  const [rawRows] = await connection.query(
    `SELECT id,name,sku,price,stock_on_hand,stock_reserved FROM products
     WHERE active=TRUE AND id IN (${placeholders})${lock ? " FOR UPDATE" : ""}`,
    ids
  );
  const rows = rawRows as ProductRow[];
  if (rows.length !== items.length) throw new HttpError(400, "One or more selected products do not exist");
  for (const item of items) {
    const product = rows.find((row) => row.id === item.productId);
    if (!product || product.stock_on_hand - product.stock_reserved < item.quantity) {
      throw new HttpError(409, `Insufficient available inventory for product ${item.productId}`);
    }
  }
  return rows;
}

router.get("/", async (req, res, next) => {
  try {
    const scope = req.user!.role === "AGENT" ? " WHERE o.agent_id=?" : "";
    const [orders] = await db.query<any[]>(
      `SELECT o.id,o.tracking_number trackingNumber,o.customer_id customerId,o.agent_id agentId,
       c.full_name customerName,o.order_status orderStatus,o.delivery_status deliveryStatus,
       o.payment_status paymentStatus,o.payment_method paymentMethod,o.cash_received cashReceived,
       o.cash_change cashChange,o.delivery_address deliveryAddress,
       o.created_at createdAt,u.full_name agentName
       FROM orders o JOIN customers c ON c.id=o.customer_id JOIN users u ON u.id=o.agent_id${scope}
       ORDER BY o.created_at DESC`,
      req.user!.role === "AGENT" ? [req.user!.id] : []
    );
    if (!orders.length) return res.json({ data: [] });
    const ids = orders.map((order) => order.id);
    const [items] = await db.query<any[]>(
      `SELECT order_id orderId,product_id productId,product_name productName,sku,quantity,unit_price unitPrice
       FROM order_items WHERE order_id IN (${ids.map(() => "?").join(",")}) ORDER BY id`,
      ids
    );
    res.json({ data: orders.map((order) => ({ ...order, items: items.filter((item) => item.orderId === order.id) })) });
  } catch (error) { next(error); }
});

router.post("/", authorize("ADMIN", "AGENT"), validate(createSchema), async (req, res, next) => {
  const connection = await db.getConnection();
  try {
    const agentId = req.user!.role === "AGENT" ? req.user!.id : req.body.agentId;
    if (!agentId) throw new HttpError(400, "Assigned agent is required");
    const [agents] = await connection.query<any[]>("SELECT id FROM users WHERE id=? AND role='AGENT' AND active=TRUE", [agentId]);
    if (!agents.length) throw new HttpError(400, "Assigned agent does not exist or is inactive");
    const products = await loadProducts(connection, req.body.items);
    const orderTotal = req.body.items.reduce((sum:number, item:{productId:number;quantity:number}) => {
      const product = products.find((candidate) => candidate.id === item.productId);
      return sum + Number(product?.price ?? 0) * item.quantity;
    }, 0);
    const cashReceived = req.body.paymentMethod === "Cash" ? req.body.cashReceived : null;
    if (req.body.paymentMethod === "Cash" && (cashReceived === null || cashReceived === undefined || cashReceived < orderTotal)) {
      throw new HttpError(400, `Cash received must be at least ${orderTotal.toFixed(2)}`);
    }
    const paymentStatus = req.body.paymentMethod === "Cash" ? "PAID" : "UNPAID";
    const cashChange = req.body.paymentMethod === "Cash" ? Number(cashReceived) - orderTotal : null;
    const trackingNumber = `TNL-${Date.now().toString(36).toUpperCase()}-${randomBytes(2).toString("hex").toUpperCase()}`;
    await connection.beginTransaction();
    const [result] = await connection.execute<any>(
      `INSERT INTO orders(tracking_number,customer_id,agent_id,delivery_address,payment_method,payment_status,cash_received,cash_change)
       VALUES(?,?,?,?,?,?,?,?)`,
      [trackingNumber, req.body.customerId, agentId, req.body.deliveryAddress, req.body.paymentMethod, paymentStatus, cashReceived, cashChange]
    );
    for (const item of req.body.items) {
      const product = products.find((candidate) => candidate.id === item.productId);
      if (!product) throw new HttpError(400, "Selected product does not exist");
      await connection.execute(
        "INSERT INTO order_items(order_id,product_id,quantity,unit_price,product_name,sku) VALUES(?,?,?,?,?,?)",
        [result.insertId, item.productId, item.quantity, product.price, product.name, product.sku]
      );
    }
    await connection.commit();
    res.status(201).json({ data: { id: result.insertId, trackingNumber, orderStatus: "PENDING", paymentStatus, cashReceived, cashChange } });
  } catch (error) { await connection.rollback(); next(error); } finally { connection.release(); }
});

router.put("/:id", validate(z.object({ body: orderBody, query: z.any(), params: z.object({ id: z.coerce.number().positive() }) })), async (req, res, next) => {
  const connection = await db.getConnection();
  try {
    const id = Number(req.params.id);
    const scope = req.user!.role === "AGENT" ? " AND agent_id=?" : "";
    const args = req.user!.role === "AGENT" ? [id, req.user!.id] : [id];
    const [orders] = await connection.query<any[]>(`SELECT order_status FROM orders WHERE id=?${scope}`, args);
    if (!orders.length) throw new HttpError(404, "Order not found");
    if (orders[0].order_status !== "PENDING") throw new HttpError(409, "Only pending orders can be edited");
    const products = await loadProducts(connection, req.body.items);
    const agentId = req.user!.role === "ADMIN" ? req.body.agentId : req.user!.id;
    if (!agentId) throw new HttpError(400, "Assigned agent is required");
    await connection.beginTransaction();
    await connection.execute("UPDATE orders SET customer_id=?,agent_id=?,delivery_address=?,payment_method=? WHERE id=?", [req.body.customerId, agentId, req.body.deliveryAddress, req.body.paymentMethod, id]);
    await connection.execute("DELETE FROM order_items WHERE order_id=?", [id]);
    for (const item of req.body.items) {
      const product = products.find((candidate) => candidate.id === item.productId);
      if (!product) throw new HttpError(400, "Selected product does not exist");
      await connection.execute("INSERT INTO order_items(order_id,product_id,quantity,unit_price,product_name,sku) VALUES(?,?,?,?,?,?)", [id, item.productId, item.quantity, product.price, product.name, product.sku]);
    }
    await connection.commit();
    res.json({ data: { id, ...req.body } });
  } catch (error) { await connection.rollback(); next(error); } finally { connection.release(); }
});

const decisionSchema = z.object({ body: z.object({ decision: z.enum(["APPROVE", "REJECT"]) }), query: z.any(), params: z.object({ id: z.coerce.number().positive() }) });
router.post("/:id/decision", authorize("ADMIN"), validate(decisionSchema), async (req, res, next) => {
  const connection = await db.getConnection();
  try {
    const orderId = Number(req.params.id);
    await connection.beginTransaction();
    const [orders] = await connection.query<any[]>("SELECT order_status FROM orders WHERE id=? FOR UPDATE", [orderId]);
    if (!orders[0] || orders[0].order_status !== "PENDING") throw new HttpError(409, "Only pending orders can be decided");
    if (req.body.decision === "APPROVE") {
      const [items] = await connection.query<any[]>("SELECT product_id productId,quantity FROM order_items WHERE order_id=?", [orderId]);
      await loadProducts(connection, items, true);
      for (const item of items) {
        await connection.execute("UPDATE products SET stock_reserved=stock_reserved+? WHERE id=?", [item.quantity, item.productId]);
        await connection.execute("INSERT INTO inventory_movements(product_id,actor_id,type,quantity,order_id) VALUES(?,?,'RESERVE',?,?)", [item.productId, req.user!.id, item.quantity, orderId]);
      }
      await connection.execute("UPDATE orders SET order_status='APPROVED',delivery_status='PREPARING' WHERE id=?", [orderId]);
      await connection.execute("INSERT INTO delivery_events(order_id,status,notes) VALUES(?,'PREPARING','Order approved and prepared for delivery')", [orderId]);
    } else await connection.execute("UPDATE orders SET order_status='REJECTED' WHERE id=?", [orderId]);
    await connection.commit();
    res.json({ data: { id: orderId, orderStatus: req.body.decision === "APPROVE" ? "APPROVED" : "REJECTED" } });
  } catch (error) { await connection.rollback(); next(error); } finally { connection.release(); }
});

router.patch("/:id/payment-status", authorize("ADMIN"), validate(z.object({ body: z.object({
  paymentStatus: z.enum(["UNPAID", "PARTIALLY_PAID", "PAID"]),
  paymentMethod: z.enum(["Cash", "Cash on delivery", "Bank transfer", "Card"]),
  cashReceived: z.number().min(0).nullable()
}), query: z.any(), params: z.object({ id: z.coerce.number().positive() }) })), async (req,res,next)=>{
  try {
    const id=Number(req.params.id);
    let cashReceived:number|null=null;
    let cashChange:number|null=null;
    if(req.body.paymentMethod==="Cash"){
      cashReceived=req.body.cashReceived;
      if(cashReceived===null)throw new HttpError(400,"Cash received is required for cash payments");
      const[totals]=await db.query<any[]>("SELECT COALESCE(SUM(quantity*unit_price),0) total FROM order_items WHERE order_id=?",[id]);
      const total=Number(totals[0]?.total??0);
      const valid=req.body.paymentStatus==="UNPAID"?cashReceived===0:req.body.paymentStatus==="PARTIALLY_PAID"?cashReceived>0&&cashReceived<total:cashReceived>=total;
      if(!valid)throw new HttpError(400,"Cash received does not match the selected payment status");
      cashChange=Math.max(0,cashReceived-total);
    }
    const [result]=await db.execute<any>("UPDATE orders SET payment_status=?,payment_method=?,cash_received=?,cash_change=? WHERE id=?",[req.body.paymentStatus,req.body.paymentMethod,cashReceived,cashChange,id]);
    if(!result.affectedRows)throw new HttpError(404,"Order not found");
    res.json({data:{id,paymentStatus:req.body.paymentStatus,paymentMethod:req.body.paymentMethod,cashReceived,cashChange}});
  } catch(error){next(error);}
});

const deliveryBody = z.object({ deliveryStatus:z.enum(["PREPARING","DISPATCHED","IN_TRANSIT","OUT_FOR_DELIVERY","DELIVERED"]),notes:z.string().max(500).optional(),latitude:z.number().min(-90).max(90).nullable().optional(),longitude:z.number().min(-180).max(180).nullable().optional() });
router.patch("/:id/delivery-status", validate(z.object({body:deliveryBody,query:z.any(),params:z.object({id:z.coerce.number().positive()})})), async(req,res,next)=>{
  const connection=await db.getConnection();
  try{
    const id=Number(req.params.id);await connection.beginTransaction();
    const scope=req.user!.role==="AGENT"?" AND agent_id=?":"";const args=req.user!.role==="AGENT"?[id,req.user!.id]:[id];
    const[orders]=await connection.query<any[]>(`SELECT agent_id,order_status,delivery_status FROM orders WHERE id=?${scope} FOR UPDATE`,args);const order=orders[0];
    if(!order)throw new HttpError(404,"Order not found");if(order.order_status!=="APPROVED"&&order.order_status!=="COMPLETED")throw new HttpError(409,"Only approved orders can progress through delivery");
    await connection.execute("UPDATE orders SET delivery_status=?,order_status=IF(?='DELIVERED','COMPLETED',order_status) WHERE id=?",[req.body.deliveryStatus,req.body.deliveryStatus,id]);
    await connection.execute("INSERT INTO delivery_events(order_id,status,notes,latitude,longitude) VALUES(?,?,?,?,?)",[id,req.body.deliveryStatus,req.body.notes??null,req.body.latitude??null,req.body.longitude??null]);
    if(req.body.deliveryStatus==="DELIVERED"&&order.delivery_status!=="DELIVERED"){
      const[items]=await connection.query<any[]>("SELECT product_id productId,quantity,unit_price unitPrice FROM order_items WHERE order_id=?",[id]);
      let total=0;for(const item of items){await connection.execute("UPDATE products SET stock_on_hand=stock_on_hand-?,stock_reserved=stock_reserved-? WHERE id=?",[item.quantity,item.quantity,item.productId]);total+=item.quantity*item.unitPrice;}
      const[agents]=await connection.query<any[]>("SELECT commission_rate FROM users WHERE id=?",[order.agent_id]);const rate=agents[0]?.commission_rate??0;
      await connection.execute("INSERT IGNORE INTO commissions(order_id,agent_id,rate,amount) VALUES(?,?,?,?)",[id,order.agent_id,rate,total*rate/100]);
    }
    await connection.commit();res.json({data:{id,deliveryStatus:req.body.deliveryStatus}});
  }catch(error){await connection.rollback();next(error);}finally{connection.release();}
});

router.delete("/:id",async(req,res,next)=>{try{const id=Number(req.params.id);const scope=req.user!.role==="AGENT"?" AND agent_id=?":"";const args=req.user!.role==="AGENT"?[id,req.user!.id]:[id];const[rows]=await db.query<any[]>(`SELECT order_status,delivery_status FROM orders WHERE id=?${scope}`,args);const order=rows[0];if(!order)throw new HttpError(404,"Order not found");if(order.order_status==="COMPLETED"||order.delivery_status==="DELIVERED")throw new HttpError(409,"Delivered or completed orders cannot be deleted");if(order.order_status==="APPROVED")throw new HttpError(409,"Approved orders with reserved inventory cannot be deleted");await db.execute("DELETE FROM orders WHERE id=?",[id]);res.status(204).send();}catch(error){next(error);}});

export default router;
