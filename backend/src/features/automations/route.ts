import { Router } from "express";
import { z } from "zod";
import { db } from "../../database/connection.js";
import { authenticate, authorize } from "../../shared/auth.js";
import { HttpError, validate } from "../../shared/http.js";
import { transaction, jsonValue } from "../../shared/transaction.js";
import { event } from "./events.js";
import { config } from "../../config.js";
import { renderWorkflowEmail } from "../../shared/email-template.js";
export const automationRouter = Router(),
  notificationRouter = Router();
automationRouter.use(authenticate, authorize("ADMIN"));
notificationRouter.use(authenticate, authorize("ADMIN", "AGENT", "DELIVERY"));
automationRouter.post(
  "/email-preview",
  validate(
    z.object({
      body: z.object({
        workflow: z.enum(["ORDER_UPDATES", "WELCOME", "PURCHASE_FOLLOWUP"]),
        subject: z.string().max(180),
        template: z.string().max(10000),
      }),
      params: z.any(),
      query: z.any(),
    }),
  ),
  (req, res) => {
    const { workflow, subject, template } = req.body;
    const rendered = renderWorkflowEmail(
      {
        config: {
          subject: subject || "Your email subject",
          template: template || "Your email message will appear here.",
        },
        vars: {
          customerName: "Maria Santos",
          trackingNumber: workflow === "WELCOME" ? undefined : "TNL-1042",
          status: "IN_TRANSIT",
        },
        ...(workflow === "ORDER_UPDATES"
          ? {}
          : {
              unsubscribe: `${config.PUBLIC_APP_URL}/portal?unsubscribe=sample-preview`,
            }),
      },
      workflow,
      config.PUBLIC_APP_URL,
    );
    // Keep the exact outgoing layout while making preview links inert.
    res.json({
      data: {
        ...rendered,
        html: rendered.html.replace(/ href=/g, " data-preview-href="),
      },
    });
  },
);
automationRouter.get("/", async (_req, res, next) => {
  try {
    const [settings] = await db.query<any[]>(
      "SELECT workflow,enabled,config,updated_at updatedAt FROM automation_settings ORDER BY workflow",
    );
    const [workers] = await db.query(
      "SELECT id,last_seen_at lastSeenAt,last_error lastError FROM worker_heartbeats WHERE id<>'scheduler' ORDER BY last_seen_at DESC LIMIT 20",
    );
    const [backlog] = await db.query(
      "SELECT state,COUNT(*) count FROM automation_runs GROUP BY state",
    );
    res.json({
      data: {
        settings: settings.map((s) => ({
          ...s,
          enabled: Boolean(s.enabled),
          config: jsonValue(s.config),
        })),
        workers,
        backlog,
      },
    });
  } catch (e) {
    next(e);
  }
});
const cfg = z
  .object({
    hours: z.number().int().min(1).max(8760).optional(),
    delayDays: z.number().min(0).max(365).optional(),
    subject: z.string().trim().min(1).max(180).optional(),
    template: z.string().trim().min(1).max(10000).optional(),
  })
  .strict();
automationRouter.put(
  "/:workflow",
  validate(
    z.object({
      body: z.object({ enabled: z.boolean(), config: cfg }),
      params: z.any(),
      query: z.any(),
    }),
  ),
  async (req, res, next) => {
    try {
      await transaction(async (c) => {
        const [rows] = await c.query<any[]>(
          "SELECT config FROM automation_settings WHERE workflow=? FOR UPDATE",
          [req.params.workflow],
        );
        if (!rows[0]) throw new HttpError(404, "Workflow not found");
        const config = {
          ...jsonValue<any>(rows[0].config),
          ...req.body.config,
        };
        await c.execute(
          "UPDATE automation_settings SET enabled=?,config=? WHERE workflow=?",
          [req.body.enabled, JSON.stringify(config), req.params.workflow],
        );
      });
      res.json({ data: { workflow: req.params.workflow } });
    } catch (e) {
      next(e);
    }
  },
);
automationRouter.get("/runs", async (req, res, next) => {
  try {
    const filter = req.query.state ? " WHERE state=?" : "";
    const [rows] = await db.query<any[]>(
      `SELECT id,workflow,dedupe_key dedupeKey,state,attempts,available_at availableAt,created_at createdAt,result,last_error lastError FROM automation_runs${filter} ORDER BY id DESC LIMIT 200`,
      req.query.state ? [String(req.query.state)] : [],
    );
    res.json({
      data: rows.map((r) => ({ ...r, result: jsonValue(r.result) })),
    });
  } catch (e) {
    next(e);
  }
});
automationRouter.post(
  "/runs/:id/retry",
  validate(
    z.object({
      body: z.object({ acknowledgeDuplicateRisk: z.boolean().default(false) }),
      params: z.any(),
      query: z.any(),
    }),
  ),
  async (req, res, next) => {
    try {
      await transaction(async (c) => {
        const [rows] = await c.query<any[]>(
          "SELECT state,attempts,last_error,result FROM automation_runs WHERE id=? FOR UPDATE",
          [Number(req.params.id)],
        );
        const run = rows[0];
        if (!run) throw new HttpError(404, "Run not found");
        if (!["FAILED", "UNKNOWN"].includes(run.state))
          throw new HttpError(
            409,
            "Only failed or unknown runs may be retried",
          );
        if (run.state === "UNKNOWN" && !req.body.acknowledgeDuplicateRisk)
          throw new HttpError(
            409,
            "Explicitly acknowledge that retrying may duplicate an email",
          );
        await event(
          c,
          "automation.retry_requested",
          "AUTOMATION_RUN",
          Number(req.params.id),
          {
            previousState: run.state,
            previousAttempts: run.attempts,
            previousError: run.last_error,
            previousResult: jsonValue(run.result),
            acknowledgeDuplicateRisk: req.body.acknowledgeDuplicateRisk,
          },
          req.user!.id,
        );
        await c.execute(
          "UPDATE automation_runs SET state='PENDING',attempts=0,send_started_at=NULL,available_at=UTC_TIMESTAMP(),last_error=NULL WHERE id=?",
          [Number(req.params.id)],
        );
      });
      res.json({ data: { id: Number(req.params.id) } });
    } catch (e) {
      next(e);
    }
  },
);
automationRouter.get("/legacy-review", async (_req, res, next) => {
  try {
    const [rows] = await db.query(
      "SELECT o.id,o.tracking_number trackingNumber,o.payment_status paymentStatus,o.delivery_status deliveryStatus,c.amount commissionAmount,CASE WHEN c.id IS NOT NULL AND o.payment_status<>'PAID' THEN 'POSTED_WITHOUT_FULL_PAYMENT' ELSE 'LEGACY_WITHOUT_PACKAGE_TERMS' END reason FROM orders o LEFT JOIN commissions c ON c.order_id=o.id WHERE o.origin='LIVE' AND (o.sales_version='LEGACY' OR (c.id IS NOT NULL AND o.payment_status<>'PAID')) ORDER BY o.id DESC LIMIT 200",
    );
    res.json({ data: rows });
  } catch (e) {
    next(e);
  }
});
notificationRouter.get("/", async (req, res, next) => {
  try {
    const [rows] = await db.query(
      "SELECT CAST(id AS CHAR) id,type,title,message,link,read_at readAt,created_at createdAt FROM staff_notifications WHERE user_id=? ORDER BY created_at DESC,id DESC LIMIT 100",
      [req.user!.id],
    );
    res.json({ data: rows });
  } catch (e) {
    next(e);
  }
});
notificationRouter.post("/read", async (req, res, next) => {
  try {
    await db.execute(
      "UPDATE staff_notifications SET read_at=UTC_TIMESTAMP() WHERE user_id=? AND read_at IS NULL",
      [req.user!.id],
    );
    res.json({ data: { read: true } });
  } catch (e) {
    next(e);
  }
});
