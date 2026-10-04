import { Router } from "express";
import { config } from "../../config.js";
import { rateLimit } from "../../shared/rate-limit.js";
import { searchPlaces } from "./geocoding.js";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import multer from "multer";
import { db } from "../../database/connection.js";
import { authenticate, authorize } from "../../shared/auth.js";
import { authenticateCustomer } from "../customer-auth/session.js";
import { HttpError, validate } from "../../shared/http.js";
import { transaction } from "../../shared/transaction.js";
import { notify, staffRecipients } from "../automations/events.js";
import { fence, statusBody, positionBody } from "./model.js";
import {
  audit,
  lockOrder,
  requireAttempt,
  endAttempt,
  stopLocations,
  advanceDelivery,
  assign,
} from "./service.js";
import { orderList, orderDetail, privateRead, tracking } from "./query.js";
import { stagePhoto, readProof } from "./photos.js";
export const deliveryRouter = Router(),
  deliveryManagementRouter = Router(),
  customerDeliveryRouter = Router();
const check = (body: z.ZodType) =>
  validate(z.object({ body, params: z.any(), query: z.any() }));
const id = (value: unknown) => {
  const r = z.coerce.number().int().positive().safeParse(value);
  if (!r.success) throw new HttpError(400, "Invalid identifier");
  return r.data;
};
deliveryRouter.use(
  authenticate,
  authorize("ADMIN", "AGENT", "DELIVERY"),
  (req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  },
);
const admin = [authenticate, authorize("ADMIN")];
const employee = authorize("DELIVERY");
deliveryRouter.get("/location-search", authorize("ADMIN"), rateLimit(30, 60000),
  validate(z.object({ body: z.any(), params: z.any(), query: z.object({ query: z.string().trim().min(3).max(200) }).strict() })),
  async (req, res) => { res.json({ data: await searchPlaces(String(req.query.query).trim(), config.GEOAPIFY_API_KEY) }); },
);

deliveryRouter.get("/dispatch", authorize("ADMIN"), async (req, res) => {
  const jobs = await orderList(req.user!, id(req.query.page ?? 1));
  res.json({
    data: await Promise.all(
      jobs.map(async (j) => ({ ...j, tracking: await tracking(j.id) })),
    ),
  });
});
deliveryRouter.get("/orders", employee, async (req, res) =>
  res.json({ data: await orderList(req.user!, id(req.query.page ?? 1)) }),
);
deliveryRouter.get("/orders/:id", async (req, res) => {
  res.json({
    data: await privateRead(id(req.params.id), req.user!, (o, c) =>
      orderDetail(o, req.user!, c),
    ),
  });
});
deliveryRouter.get("/orders/:id/tracking", async (req, res) => {
  res.json({
    data: await privateRead(id(req.params.id), req.user!, (_o, c) =>
      tracking(id(req.params.id), c),
    ),
  });
});
deliveryRouter.get("/orders/:id/proof-photo", async (req, res) => {
  res
    .type("jpeg")
    .send(
      await privateRead(id(req.params.id), req.user!, (_o, c) =>
        readProof(id(req.params.id), c),
      ),
    );
});
deliveryRouter.post(
  "/orders/:id/start",
  employee,
  check(fence.omit({ attemptId: true }).strict()),
  async (req, res) => {
    const data = await transaction(async (c) => {
      const o = await lockOrder(
        c,
        id(req.params.id),
        req.user!,
        req.body.assignmentVersion,
      );
      if (o.order_status !== "APPROVED" || o.delivery_status === "DELIVERED")
        throw new HttpError(
          409,
          "Only approved unfinished deliveries can start",
        );
      const [issues] = await c.query<any[]>(
        "SELECT id FROM delivery_issues WHERE order_id=? AND resolved_at IS NULL LIMIT 1",
        [o.id],
      );
      if (issues.length)
        throw new HttpError(
          409,
          "An admin must resolve the delivery issue before another attempt",
        );
      const [active] = await c.query<any[]>(
        "SELECT * FROM delivery_active_jobs WHERE employee_id=? FOR UPDATE",
        [req.user!.id],
      );
      if (active.length) {
        if (active[0].order_id === o.id)
          return { attemptId: active[0].attempt_id };
        throw new HttpError(
          409,
          "Pause or complete your active delivery first",
        );
      }
      const attemptId = randomUUID();
      await c.execute(
        "INSERT INTO delivery_attempts(id,order_id,employee_id,assignment_version) VALUES(?,?,?,?)",
        [attemptId, o.id, req.user!.id, o.delivery_assignment_version],
      );
      await c.execute(
        "INSERT INTO delivery_active_jobs(employee_id,order_id,attempt_id) VALUES(?,?,?)",
        [req.user!.id, o.id, attemptId],
      );
      if (o.delivery_status === "PREPARING")
        await advanceDelivery(c, o, req.user!, {
          deliveryStatus: "DISPATCHED",
          attemptId,
        });
      await audit(
        c,
        o.id,
        req.user!.id,
        "DELIVERY_STARTED",
        "Delivery attempt started.",
      );
      return { attemptId };
    });
    res.json({ data });
  },
);
deliveryRouter.post(
  "/orders/:id/pause",
  employee,
  check(fence.strict()),
  async (req, res) => {
    await transaction(async (c) => {
      const o = await lockOrder(
        c,
        id(req.params.id),
        req.user!,
        req.body.assignmentVersion,
      );
      await requireAttempt(c, o, req.user!, req.body.attemptId);
      await endAttempt(c, o.id, "PAUSED");
      await audit(
        c,
        o.id,
        req.user!.id,
        "DELIVERY_PAUSED",
        "Delivery attempt paused.",
      );
    });
    res.json({ data: { paused: true } });
  },
);
deliveryRouter.post(
  "/orders/:id/issues",
  employee,
  check(
    fence.extend({ explanation: z.string().trim().min(5).max(500) }).strict(),
  ),
  async (req, res) => {
    await transaction(async (c) => {
      const o = await lockOrder(
        c,
        id(req.params.id),
        req.user!,
        req.body.assignmentVersion,
      );
      await requireAttempt(c, o, req.user!, req.body.attemptId);
      await c.execute(
        "INSERT INTO delivery_issues(order_id,employee_id,explanation) VALUES(?,?,?)",
        [o.id, req.user!.id, req.body.explanation],
      );
      await endAttempt(c, o.id, "ISSUE");
      await audit(
        c,
        o.id,
        req.user!.id,
        "DELIVERY_ISSUE",
        req.body.explanation,
      );
      await notify(
        c,
        await staffRecipients(c, o.agent_id),
        randomUUID(),
        "DELIVERY_ISSUE",
        "Delivery needs attention",
        `${o.tracking_number} · ${req.body.explanation}`,
        `/orders/${o.id}`,
      );
    });
    res.json({ data: { reported: true } });
  },
);
deliveryRouter.patch(
  "/orders/:id/status",
  employee,
  check(statusBody),
  async (req, res) => {
    const data = await transaction(async (c) =>
      advanceDelivery(
        c,
        await lockOrder(
          c,
          id(req.params.id),
          req.user!,
          req.body.assignmentVersion,
        ),
        req.user!,
        req.body,
      ),
    );
    res.json({ data });
  },
);
deliveryRouter.post(
  "/orders/:id/tracking/start",
  employee,
  check(fence.strict()),
  async (req, res) => {
    const data = await transaction(async (c) => {
      const o = await lockOrder(
        c,
        id(req.params.id),
        req.user!,
        req.body.assignmentVersion,
      );
      await requireAttempt(c, o, req.user!, req.body.attemptId);
      await stopLocations(c, o.id);
      const sessionId = randomUUID();
      await c.execute(
        "INSERT INTO delivery_location_sessions(id,attempt_id,token_version,expires_at) VALUES(?,?,?,?)",
        [
          sessionId,
          req.body.attemptId,
          req.user!.tokenVersion ?? 0,
          new Date(req.user!.expiresAt!),
        ],
      );
      return { sessionId };
    });
    res.json({ data });
  },
);
deliveryRouter.post(
  "/orders/:id/tracking/stop",
  employee,
  check(fence.extend({ sessionId: z.uuid() }).strict()),
  async (req, res) => {
    await transaction(async (c) => {
      const o = await lockOrder(
        c,
        id(req.params.id),
        req.user!,
        req.body.assignmentVersion,
      );
      await requireAttempt(c, o, req.user!, req.body.attemptId);
      await c.execute(
        "DELETE p FROM delivery_latest_positions p JOIN delivery_location_sessions s ON s.id=p.session_id WHERE s.id=? AND s.attempt_id=?",
        [req.body.sessionId, req.body.attemptId],
      );
      await c.execute(
        "UPDATE delivery_location_sessions SET ended_at=UTC_TIMESTAMP() WHERE id=? AND attempt_id=?",
        [req.body.sessionId, req.body.attemptId],
      );
    });
    res.json({ data: { stopped: true } });
  },
);
deliveryRouter.post(
  "/orders/:id/positions",
  employee,
  check(positionBody),
  async (req, res) => {
    const data = await transaction(async (c) => {
      const b = req.body,
        o = await lockOrder(
          c,
          id(req.params.id),
          req.user!,
          b.assignmentVersion,
        );
      await requireAttempt(c, o, req.user!, b.attemptId);
      const [sessions] = await c.query<any[]>(
        "SELECT id FROM delivery_location_sessions WHERE id=? AND attempt_id=? AND token_version=? AND ended_at IS NULL AND expires_at>? FOR UPDATE",
        [b.sessionId, b.attemptId, req.user!.tokenVersion ?? 0, new Date()],
      );
      if (!sessions.length)
        throw new HttpError(
          409,
          "Location sharing stopped. Start sharing again.",
        );
      const observed = new Date(b.observedAt),
        now = Date.now();
      if (observed.getTime() > now + 30000 || observed.getTime() < now - 600000)
        throw new HttpError(
          400,
          "GPS fix time is invalid. Check device time and acquire a new fix.",
        );
      const [old] = await c.query<any[]>(
        "SELECT sequence,observed_at observed FROM delivery_latest_positions WHERE session_id=? FOR UPDATE",
        [b.sessionId],
      );
      if (
        old[0] &&
        (Number(old[0].sequence) >= b.sequence ||
          new Date(old[0].observed).getTime() >= observed.getTime())
      )
        return { accepted: false };
      await c.execute(
        "INSERT INTO delivery_latest_positions(session_id,latitude,longitude,accuracy,observed_at,received_at,sequence) VALUES(?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE latitude=VALUES(latitude),longitude=VALUES(longitude),accuracy=VALUES(accuracy),observed_at=VALUES(observed_at),received_at=VALUES(received_at),sequence=VALUES(sequence)",
        [
          b.sessionId,
          b.latitude,
          b.longitude,
          b.accuracy,
          observed,
          new Date(now),
          b.sequence,
        ],
      );
      return { accepted: true };
    });
    res.json({ data });
  },
);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 2, parts: 3 },
}).single("photo");
deliveryRouter.post(
  "/orders/:id/proof-photo",
  authorize("ADMIN", "DELIVERY"),
  (req, res, next) =>
    upload(req, res, (e) =>
      next(
        e
          ? new HttpError(
              (e as any).code === "LIMIT_FILE_SIZE" ? 413 : 400,
              "Upload one photo up to 10 MiB with assignmentVersion and attemptId",
            )
          : undefined,
      ),
    ),
  async (req, res) => {
    if (!req.file) throw new HttpError(400, "Choose a proof photo");
    const body = fence.strict().safeParse({
      ...req.body,
      assignmentVersion: Number(req.body.assignmentVersion),
    });
    if (!body.success)
      throw new HttpError(400, "Invalid delivery assignment or attempt");
    res.status(201).json({
      data: await stagePhoto(
        id(req.params.id),
        req.user!,
        body.data,
        req.file.buffer,
      ),
    });
  },
);
deliveryManagementRouter.patch(
  "/:id/delivery-assignment",
  ...admin,
  check(
    z
      .object({
        employeeId: z.number().int().positive().nullable(),
        assignmentVersion: z.number().int().nonnegative(),
      })
      .strict(),
  ),
  async (req, res) => {
    await transaction(async (c) => {
      const o = await lockOrder(
        c,
        id(req.params.id),
        req.user!,
        req.body.assignmentVersion,
      );
      await assign(c, o, req.body.employeeId, req.user!.id);
    });
    res.json({ data: { assigned: true } });
  },
);
deliveryManagementRouter.patch(
  "/:id/delivery-destination",
  ...admin,
  check(
    z
      .object({
        latitude: z.number().min(-90).max(90).nullable(),
        longitude: z.number().min(-180).max(180).nullable(),
        assignmentVersion: z.number().int().nonnegative(),
      })
      .strict()
      .refine((b) => (b.latitude === null) === (b.longitude === null)),
  ),
  async (req, res) => {
    await transaction(async (c) => {
      const o = await lockOrder(
        c,
        id(req.params.id),
        req.user!,
        req.body.assignmentVersion,
      );
      if (o.delivery_status === "DELIVERED" || o.order_status !== "APPROVED")
        throw new HttpError(
          409,
          "Only unfinished approved delivery destinations can change",
        );
      await c.execute(
        "UPDATE orders SET destination_latitude=?,destination_longitude=? WHERE id=?",
        [req.body.latitude, req.body.longitude, o.id],
      );
      await audit(
        c,
        o.id,
        req.user!.id,
        "DELIVERY_DESTINATION",
        `Destination pin changed from (${o.destination_latitude ?? "none"}, ${o.destination_longitude ?? "none"}) to (${req.body.latitude ?? "none"}, ${req.body.longitude ?? "none"}). Saved address retained.`,
      );
    });
    res.json({ data: { saved: true } });
  },
);
deliveryManagementRouter.post(
  "/:id/delivery-issues/:issueId/resolve",
  ...admin,
  check(z.object({ resolution: z.string().trim().min(5).max(500) }).strict()),
  async (req, res) => {
    await transaction(async (c) => {
      const o = await lockOrder(c, id(req.params.id), req.user!);
      const [issues] = await c.query<any[]>(
        "SELECT * FROM delivery_issues WHERE id=? AND order_id=? FOR UPDATE",
        [id(req.params.issueId), o.id],
      );
      if (!issues[0]) throw new HttpError(404, "Issue not found");
      if (!issues[0].resolved_at) {
        await c.execute(
          "UPDATE delivery_issues SET resolved_by=?,resolved_at=UTC_TIMESTAMP(),resolution=? WHERE id=?",
          [req.user!.id, req.body.resolution, id(req.params.issueId)],
        );
        await audit(
          c,
          o.id,
          req.user!.id,
          "DELIVERY_ISSUE_RESOLVED",
          req.body.resolution,
        );
        if (o.delivery_employee_id)
          await notify(
            c,
            [o.delivery_employee_id],
            randomUUID(),
            "DELIVERY_ISSUE_RESOLVED",
            "Delivery ready to retry",
            o.tracking_number,
            `/delivery/${o.id}`,
          );
      }
    });
    res.json({ data: { resolved: true } });
  },
);
customerDeliveryRouter.use(authenticateCustomer, (req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});
customerDeliveryRouter.get("/:id/delivery", async (req, res) => {
  const user = {
    role: "CUSTOMER" as const,
    customerId: req.customer!.customerId,
  };
  res.json({
    data: await privateRead(id(req.params.id), user, (o, c) =>
      orderDetail(o, user, c),
    ),
  });
});
customerDeliveryRouter.get("/:id/delivery-tracking", async (req, res) => {
  res.json({
    data: await privateRead(
      id(req.params.id),
      { role: "CUSTOMER", customerId: req.customer!.customerId },
      (_o, c) => tracking(id(req.params.id), c),
    ),
  });
});
customerDeliveryRouter.get("/:id/proof-photo", async (req, res) => {
  res
    .type("jpeg")
    .send(
      await privateRead(
        id(req.params.id),
        { role: "CUSTOMER", customerId: req.customer!.customerId },
        (_o, c) => readProof(id(req.params.id), c),
      ),
    );
});
