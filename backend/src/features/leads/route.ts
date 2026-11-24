import { formatName, namePartsSchema, storedParts } from "../../shared/contact-fields.js";
import { Router } from "express";
import { z } from "zod";
import { db } from "../../database/connection.js";
import { authenticate, authorize } from "../../shared/auth.js";
import { HttpError, validate } from "../../shared/http.js";
import { normalizePhPhone } from "../../shared/phone.js";

const phoneField = z.string().transform((value, ctx) => {
  const normalized = normalizePhPhone(value);
  if (!normalized) { ctx.addIssue({ code: "custom", message: "Enter a valid PH mobile number, e.g. 09171234567" }); return z.NEVER; }
  return normalized;
});

const router = Router();
router.use(authenticate, authorize("ADMIN"));
router.get("/", async (req,res,next)=>{try{const search=`%${String(req.query.search??"")}%`;const source=String(req.query.source??"");const filter=source?" AND l.source=?":"";const args:any[]=[search,search,search];if(source)args.push(source);const [rows]=await db.query(`SELECT l.id,l.full_name fullName,l.name_parts nameParts,l.email,l.phone,l.source,l.status,l.assigned_agent_id assignedAgentId,u.full_name assignedAgentName FROM leads l LEFT JOIN users u ON u.id=l.assigned_agent_id WHERE (l.full_name LIKE ? OR l.email LIKE ? OR l.phone LIKE ?)${filter} ORDER BY l.created_at DESC`,args);res.json({data:rows});}catch(e){next(e);}});
const body=z.object({fullName:z.string().min(2).max(160),nameParts:namePartsSchema.optional(),email:z.email(),phone:phoneField,source:z.string().min(2).max(100),assignedAgentId:z.number().int().positive().nullable().optional(),status:z.enum(["NEW","CONTACTED","QUALIFIED","LOST"]).default("NEW")});
router.post("/",validate(z.object({body,query:z.any(),params:z.any()})),async(req,res,next)=>{try{const[r]=await db.execute<any>("INSERT INTO leads(full_name,name_parts,email,phone,source,assigned_agent_id,status) VALUES(?,?,?,?,?,?,?)",[req.body.nameParts ? formatName(req.body.nameParts) : req.body.fullName,storedParts(req.body.nameParts),req.body.email.toLowerCase(),req.body.phone,req.body.source,req.body.assignedAgentId??null,req.body.status]);res.status(201).json({data:{id:r.insertId,...req.body}});}catch(e:any){if(e?.code==="ER_DUP_ENTRY")return next(new HttpError(409,"Lead email already exists"));next(e);}});
router.put("/:id", validate(z.object({ body, query: z.any(), params: z.object({ id: z.coerce.number().positive() }) })), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { nameParts, email, phone, source, assignedAgentId, status } = req.body;
    const fullName = nameParts ? formatName(nameParts) : req.body.fullName;
    const parts = storedParts(nameParts);
    await db.execute(
      "UPDATE leads SET name_parts=IF(? IS NULL AND full_name=?,name_parts,?),full_name=?,email=?,phone=?,source=?,assigned_agent_id=?,status=? WHERE id=? AND status<>'CONVERTED'",
      [parts, fullName, parts, fullName, email.toLowerCase(), phone, source, assignedAgentId ?? null, status, id],
    );
    res.json({ data: { id, ...req.body, fullName } });
  } catch (error) { next(error); }
});
router.delete("/:id",async(req,res,next)=>{try{const[r]=await db.execute<any>("DELETE FROM leads WHERE id=? AND status<>'CONVERTED'",[Number(req.params.id)]);if(!r.affectedRows)throw new HttpError(409,"Converted leads cannot be deleted");res.status(204).send();}catch(e){next(e);}});
router.post("/:id/convert",async(req,res,next)=>{const connection=await db.getConnection();try{const id=Number(req.params.id);await connection.beginTransaction();const[rows]=await connection.query<any[]>("SELECT * FROM leads WHERE id=? AND status<>'CONVERTED' FOR UPDATE",[id]);const lead=rows[0];if(!lead)throw new HttpError(409,"Lead is missing or already converted");const[existing]=await connection.query<any[]>("SELECT id FROM customers WHERE email=?",[lead.email]);let customerId=existing[0]?.id;if(!customerId){const[r]=await connection.execute<any>("INSERT INTO customers(full_name,name_parts,email,phone,address,assigned_agent_id) VALUES(?,?,?,?,'Address pending',?)",[lead.full_name,storedParts(lead.name_parts),lead.email,lead.phone,lead.assigned_agent_id]);customerId=r.insertId;}await connection.execute("UPDATE leads SET status='CONVERTED',converted_customer_id=? WHERE id=?",[customerId,id]);await connection.commit();res.json({data:{leadId:id,customerId,status:"CONVERTED"}});}catch(e){await connection.rollback();next(e);}finally{connection.release();}});
export default router;
