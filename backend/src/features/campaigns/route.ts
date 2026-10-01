import { Router } from "express";
import { z } from "zod";
import { db } from "../../database/connection.js";
import { authenticate, authorize } from "../../shared/auth.js";
import { HttpError, validate } from "../../shared/http.js";
import { transaction, jsonValue } from "../../shared/transaction.js";
import { campaignRecipients, queueCampaign } from "../automations/campaigns.js";
const router = Router();
router.use(authenticate, authorize("ADMIN"));
const body = z
  .object({
    name: z.string().trim().min(2).max(180),
    targetAudience: z.string().max(500).default("All eligible customers"),
    content: z.string().min(2).max(100000),
    startDate: z.string().date(),
    endDate: z.string().date(),
    status: z.enum(["DRAFT", "SCHEDULED"]).default("DRAFT"),
    audienceType: z.enum(["ALL", "SELECTED"]).default("ALL"),
    customerIds: z.array(z.number().int().positive()).max(10000).default([]),
    scheduledAt: z.string().datetime({ offset: true }).nullable().default(null),
  })
  .refine(
    (v) => v.endDate > v.startDate,
    "End date must be later than start date",
  )
  .refine(
    (v) => v.audienceType !== "SELECTED" || v.customerIds.length > 0,
    "Select at least one customer",
  )
  .refine(
    (v) => v.status !== "SCHEDULED" || Boolean(v.scheduledAt),
    "Scheduled campaigns require a send time",
  )
  .refine(
    (v) =>
      !v.scheduledAt ||
      (() => {
        const day = new Intl.DateTimeFormat("en-CA", {
          timeZone: "Asia/Manila",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        }).format(new Date(v.scheduledAt));
        return day >= v.startDate && day <= v.endDate;
      })(),
    "Send time must fall within the campaign date window",
  );
const valid = validate(z.object({ body, params: z.any(), query: z.any() }));
router.get("/", async (req, res, next) => {
  try {
    const [rows] = await db.query<any[]>(
      "SELECT id,name,target_audience targetAudience,content,start_date startDate,end_date endDate,status,audience_type audienceType,customer_ids customerIds,scheduled_at scheduledAt FROM campaigns WHERE name LIKE ? ORDER BY created_at DESC,id DESC",
      [`%${String(req.query.search ?? "")}%`],
    );
    res.json({
      data: rows.map((r) => ({
        ...r,
        customerIds: jsonValue(r.customerIds ?? []),
      })),
    });
  } catch (e) {
    next(e);
  }
});
async function save(id: number | null, v: any) {
  return transaction(async (c) => {
    if (id) {
      const [runs] = await c.query<any[]>(
        "SELECT ca.id,cr.id run_id FROM campaigns ca LEFT JOIN campaign_runs cr ON cr.campaign_id=ca.id WHERE ca.id=? FOR UPDATE",
        [id],
      );
      if (!runs.length) throw new HttpError(404, "Campaign not found");
      if (runs[0].run_id)
        throw new HttpError(
          409,
          "Queued campaign terms are immutable; create a new campaign",
        );
      await c.execute(
        "UPDATE campaigns SET name=?,target_audience=?,content=?,start_date=?,end_date=?,status=?,audience_type=?,customer_ids=?,scheduled_at=? WHERE id=?",
        [
          v.name,
          v.audienceType === "ALL"
            ? "All eligible customers"
            : "Selected customers",
          v.content,
          v.startDate,
          v.endDate,
          v.status,
          v.audienceType,
          JSON.stringify([...new Set(v.customerIds)]),
          v.scheduledAt ? new Date(v.scheduledAt) : null,
          id,
        ],
      );
    } else {
      const [r] = await c.execute<any>(
        "INSERT INTO campaigns(name,target_audience,content,start_date,end_date,status,audience_type,customer_ids,scheduled_at) VALUES(?,?,?,?,?,?,?,?,?)",
        [
          v.name,
          v.audienceType === "ALL"
            ? "All eligible customers"
            : "Selected customers",
          v.content,
          v.startDate,
          v.endDate,
          v.status,
          v.audienceType,
          JSON.stringify([...new Set(v.customerIds)]),
          v.scheduledAt ? new Date(v.scheduledAt) : null,
        ],
      );
      id = r.insertId;
    }
    return { id };
  });
}
router.post("/", valid, async (req, res, next) => {
  try {
    res.status(201).json({ data: await save(null, req.body) });
  } catch (e: any) {
    next(
      e.code === "ER_DUP_ENTRY"
        ? new HttpError(409, "Campaign name already exists")
        : e,
    );
  }
});
router.put("/:id", valid, async (req, res, next) => {
  try {
    res.json({ data: await save(Number(req.params.id), req.body) });
  } catch (e: any) {
    next(
      e.code === "ER_DUP_ENTRY"
        ? new HttpError(409, "Campaign name already exists")
        : e,
    );
  }
});
router.get("/:id/recipients", async (req, res, next) => {
  try {
    const [rows] = await db.query<any[]>("SELECT * FROM campaigns WHERE id=?", [
      Number(req.params.id),
    ]);
    if (!rows[0]) throw new HttpError(404, "Campaign not found");
    const data = await campaignRecipients(db, rows[0]);
    res.json({ data, meta: { total: data.length } });
  } catch (e) {
    next(e);
  }
});
router.post("/:id/send", async (req, res, next) => {
  try {
    const data = await transaction((c) =>
      queueCampaign(c, Number(req.params.id), req.user!.id),
    );
    res.status(202).json({ data });
  } catch (e) {
    next(e);
  }
});
router.get("/:id/results", async (req, res, next) => {
  try {
    const [rows] = await db.query<any[]>(
      "SELECT id,state,attempts,JSON_EXTRACT(payload,'$.customerId') customerId,result,last_error lastError FROM automation_runs WHERE workflow='CAMPAIGN_SEND' AND JSON_EXTRACT(payload,'$.campaignId')=? ORDER BY id",
      [Number(req.params.id)],
    );
    res.json({
      data: rows.map((r) => ({ ...r, result: jsonValue(r.result) })),
    });
  } catch (e) {
    next(e);
  }
});
router.delete("/:id", async (req, res, next) => {
  try {
    await transaction(async (c) => {
      const id = Number(req.params.id);
      const [rows] = await c.query<any[]>(
        "SELECT id FROM campaigns WHERE id=? FOR UPDATE",
        [id],
      );
      if (!rows.length) throw new HttpError(404, "Campaign not found");
      const [runs] = await c.query<any[]>(
        "SELECT id FROM campaign_runs WHERE campaign_id=?",
        [id],
      );
      if (runs.length)
        throw new HttpError(
          409,
          "Campaigns with execution history must be retained",
        );
      await c.execute("DELETE FROM campaigns WHERE id=?", [id]);
    });
    res.status(204).send();
  } catch (e) {
    next(e);
  }
});
export default router;
