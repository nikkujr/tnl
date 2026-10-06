import { Router } from "express";
import { z } from "zod";
import { db } from "../../database/connection.js";
import { authenticate, authorize } from "../../shared/auth.js";
import { HttpError, validate } from "../../shared/http.js";
import { saleTotalSql } from "../orders/queries.js";
import agentRewardsRouter from "./agent-rewards.js";
import {
  completedSaleSql,
  currentPeriod,
  moneySchema,
  monthBounds,
  periodSchema,
} from "./model.js";

const router = Router();
router.use(authenticate, authorize("ADMIN", "AGENT"));
router.use(agentRewardsRouter);
router.use(authorize("ADMIN"));
const bodyValidation = (body: z.ZodType, params: z.ZodType = z.any()) =>
  validate(z.object({ body, params, query: z.any() }));
const positiveId = z.coerce.number().int().positive();
const keySchema = z
  .string()
  .min(16)
  .max(64)
  .regex(/^[a-zA-Z0-9_-]+$/);

router.get(
  "/",
  validate(
    z.object({
      body: z.any(),
      params: z.any(),
      query: z.object({ month: periodSchema.optional() }),
    }),
  ),
  async (req, res, next) => {
    try {
      const period = String(req.query.month ?? currentPeriod());
      const { start, end, days } = monthBounds(period);
      const [agents] = await db.query<any[]>(
        `SELECT u.id,u.full_name fullName,u.active,
      COALESCE(s.sales,0) sales,COALESCE(s.deals,0) deals,
      COALESCE(p.pipeline,0) pipeline,COALESCE(p.pending,0) pending,
      COALESCE(c.commission,0) commission,t.id targetId,t.sales_target salesTarget,t.incentive_amount incentiveAmount,
      COALESCE(r.incentives,0) incentives,COALESCE(r.bonuses,0) bonuses,ri.id incentiveRewardId,
      COALESCE(fb.reviewCount,0) reviewCount,fb.averageRating averageRating
      FROM users u
      LEFT JOIN (SELECT o.agent_id,SUM(${saleTotalSql("o")}) sales,COUNT(*) deals FROM orders o WHERE ${completedSaleSql} GROUP BY o.agent_id) s ON s.agent_id=u.id
      LEFT JOIN (SELECT o.agent_id,COUNT(*) pipeline,SUM(o.order_status='PENDING') pending FROM orders o
        WHERE o.origin='LIVE' AND o.sales_version='PACKAGE' AND o.created_at>=? AND o.created_at<?
        AND o.order_status IN ('PENDING','APPROVED','COMPLETED') AND NOT(o.delivery_status<=>'DELIVERED' AND o.payment_status='PAID') GROUP BY o.agent_id) p ON p.agent_id=u.id
      LEFT JOIN (SELECT co.agent_id,SUM(co.amount) commission FROM commissions co JOIN orders o ON o.id=co.order_id
        WHERE co.source='PACKAGE' AND o.origin='LIVE' AND co.created_at>=? AND co.created_at<? GROUP BY co.agent_id) c ON c.agent_id=u.id
      LEFT JOIN agent_targets t ON t.agent_id=u.id AND t.period=?
      LEFT JOIN agent_rewards ri ON ri.target_id=t.id
      LEFT JOIN (SELECT agent_id,SUM(IF(kind='INCENTIVE',amount,0)) incentives,SUM(IF(kind='BONUS',amount,0)) bonuses FROM agent_rewards WHERE period=? GROUP BY agent_id) r ON r.agent_id=u.id
      LEFT JOIN (SELECT agent_id,COUNT(*) reviewCount,ROUND(AVG(rating),2) averageRating FROM order_reviews WHERE created_at>=? AND created_at<? GROUP BY agent_id) fb ON fb.agent_id=u.id
      WHERE u.role='AGENT' ORDER BY sales DESC,deals DESC,u.id ASC`,
        [start, end, start, end, start, end, period, period, start, end],
      );
      const [daily] = await db.query<any[]>(
        `SELECT DATE_FORMAT(DATE_ADD(o.sale_completed_at,INTERVAL 8 HOUR),'%Y-%m-%d') day,
      SUM(${saleTotalSql("o")}) sales,COUNT(*) deals FROM orders o WHERE ${completedSaleSql} GROUP BY day ORDER BY day`,
        [start, end],
      );
      const [rewards] = await db.query<any[]>(
        `SELECT r.id,r.agent_id agentId,u.full_name agentName,r.kind,r.amount,r.reason,r.created_at createdAt,a.full_name approvedBy
      FROM agent_rewards r JOIN users u ON u.id=r.agent_id JOIN users a ON a.id=r.approved_by WHERE r.period=? ORDER BY r.id DESC`,
        [period],
      );
      const [reviews] = await db.query<any[]>(
        `SELECT r.order_id orderId,o.tracking_number trackingNumber,c.full_name customerName,
          r.agent_id agentId,u.full_name agentName,r.rating,r.review,r.created_at createdAt
         FROM order_reviews r JOIN orders o ON o.id=r.order_id JOIN customers c ON c.id=r.customer_id
         LEFT JOIN users u ON u.id=r.agent_id WHERE r.created_at>=? AND r.created_at<?
         ORDER BY r.created_at DESC,r.order_id DESC`, [start, end],
      );
      const trend = Array.from({ length: days }, (_, i) => {
        const day = `${period}-${String(i + 1).padStart(2, "0")}`;
        return { day, sales: 0, deals: 0, ...daily.find((d) => d.day === day) };
      });
      const rows = agents.map((a, i) => ({
        ...a,
        rank: i + 1,
        progress: a.salesTarget
          ? Math.round((Number(a.sales) / Number(a.salesTarget)) * 10000) / 100
          : null,
        incentiveStatus: a.incentiveRewardId
          ? "APPROVED"
          : !a.targetId || !Number(a.incentiveAmount)
            ? "NONE"
            : Number(a.sales) >= Number(a.salesTarget)
              ? "ELIGIBLE"
              : "IN_PROGRESS",
      }));
      const totals = rows.reduce(
        (sum, a) => ({
          sales: sum.sales + Number(a.sales),
          deals: sum.deals + Number(a.deals),
          commission: sum.commission + Number(a.commission),
          incentives: sum.incentives + Number(a.incentives),
          bonuses: sum.bonuses + Number(a.bonuses),
          targetsMet:
            sum.targetsMet +
            (a.targetId && Number(a.sales) >= Number(a.salesTarget) ? 1 : 0),
          targetsSet: sum.targetsSet + (a.targetId ? 1 : 0),
        }),
        {
          sales: 0,
          deals: 0,
          commission: 0,
          incentives: 0,
          bonuses: 0,
          targetsMet: 0,
          targetsSet: 0,
        },
      );
      res.json({
        data: {
          period,
          timeZone: "Asia/Manila",
          agents: rows,
          trend,
          rewards,
          reviews,
          totals,
        },
      });
    } catch (error) {
      next(error);
    }
  },
);

router.put(
  "/targets/:agentId/:period",
  bodyValidation(
    z.object({
      salesTarget: moneySchema.refine((v) => v > 0),
      incentiveAmount: moneySchema,
    }),
    z.object({ agentId: positiveId, period: periodSchema }),
  ),
  async (req, res, next) => {
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      const agentId = Number(req.params.agentId),
        period = String(req.params.period);
      const [agents] = await conn.query<any[]>(
        "SELECT id FROM users WHERE id=? AND role='AGENT' FOR UPDATE",
        [agentId],
      );
      if (!agents.length) throw new HttpError(404, "Agent not found");
      const [targets] = await conn.query<any[]>(
        "SELECT t.*,r.id reward_id FROM agent_targets t LEFT JOIN agent_rewards r ON r.target_id=t.id WHERE t.agent_id=? AND t.period=? FOR UPDATE",
        [agentId, period],
      );
      if (
        targets[0]?.reward_id &&
        (Number(targets[0].sales_target) !== req.body.salesTarget ||
          Number(targets[0].incentive_amount) !== req.body.incentiveAmount)
      )
        throw new HttpError(
          409,
          "This target has an approved incentive. Its terms cannot be changed.",
        );
      await conn.execute(
        `INSERT INTO agent_targets(agent_id,period,sales_target,incentive_amount,updated_by) VALUES(?,?,?,?,?) ON DUPLICATE KEY UPDATE sales_target=VALUES(sales_target),incentive_amount=VALUES(incentive_amount),updated_by=VALUES(updated_by)`,
        [
          agentId,
          period,
          req.body.salesTarget,
          req.body.incentiveAmount,
          req.user!.id,
        ],
      );
      await conn.commit();
      res.json({ data: { saved: true } });
    } catch (error) {
      await conn.rollback();
      next(error);
    } finally {
      conn.release();
    }
  },
);

router.post(
  "/incentives/:targetId/approve",
  bodyValidation(
    z.object({ idempotencyKey: keySchema }),
    z.object({ targetId: positiveId }),
  ),
  async (req, res, next) => {
    const conn = await db.getConnection();
    try {
      const targetId = Number(req.params.targetId);
      const [owners] = await conn.query<any[]>(
        "SELECT agent_id FROM agent_targets WHERE id=?",
        [targetId],
      );
      if (!owners[0]) throw new HttpError(404, "Target not found");
      // Resolve the immutable owner before starting the transaction, so this lookup
      // does not establish a stale repeatable-read snapshot while waiting for a lock.
      await conn.beginTransaction();
      // Match target edits and bonuses: lock the agent before target/reward rows.
      await conn.query("SELECT id FROM users WHERE id=? FOR UPDATE", [
        owners[0].agent_id,
      ]);
      const [targets] = await conn.query<any[]>(
        "SELECT * FROM agent_targets WHERE id=? FOR UPDATE",
        [targetId],
      );
      const target = targets[0];
      if (!target) throw new HttpError(404, "Target not found");
      const [existing] = await conn.query<any[]>(
        "SELECT * FROM agent_rewards WHERE target_id=? OR idempotency_key=?",
        [targetId, req.body.idempotencyKey],
      );
      if (existing.length) {
        if (existing.some((r) => r.target_id !== targetId))
          throw new HttpError(
            409,
            "This submission key was used for another reward",
          );
        await conn.commit();
        res.json({ data: { id: existing[0].id, reused: true } });
        return;
      }
      const { start, end } = monthBounds(target.period);
      const [sales] = await conn.query<any[]>(
        `SELECT COALESCE(SUM(${saleTotalSql("o")}),0) sales FROM orders o WHERE o.agent_id=? AND ${completedSaleSql}`,
        [target.agent_id, start, end],
      );
      if (Number(sales[0].sales) < Number(target.sales_target))
        throw new HttpError(
          409,
          "The monthly sales target has not been reached",
        );
      if (Number(target.incentive_amount) <= 0)
        throw new HttpError(409, "This target has no incentive amount");
      const [result] = await conn.execute<any>(
        "INSERT INTO agent_rewards(agent_id,period,kind,target_id,amount,reason,approved_by,idempotency_key) VALUES(?,?,'INCENTIVE',?,?,?,?,?)",
        [
          target.agent_id,
          target.period,
          targetId,
          target.incentive_amount,
          `Monthly sales target reached: ${target.period}`,
          req.user!.id,
          req.body.idempotencyKey,
        ],
      );
      await conn.commit();
      res.status(201).json({ data: { id: result.insertId, reused: false } });
    } catch (error: any) {
      await conn.rollback();
      next(
        error.code === "ER_DUP_ENTRY"
          ? new HttpError(
              409,
              "Submission key already used; reload the reward history",
            )
          : error,
      );
    } finally {
      conn.release();
    }
  },
);

router.post(
  "/bonuses",
  bodyValidation(
    z.object({
      agentId: positiveId,
      period: periodSchema,
      amount: moneySchema.refine((v) => v > 0),
      reason: z.string().trim().min(3).max(500),
      idempotencyKey: keySchema,
    }),
  ),
  async (req, res, next) => {
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      const { agentId, period, amount, reason, idempotencyKey } = req.body;
      const [agents] = await conn.query<any[]>(
        "SELECT id FROM users WHERE id=? AND role='AGENT' FOR UPDATE",
        [agentId],
      );
      if (!agents.length) throw new HttpError(404, "Agent not found");
      const [existing] = await conn.query<any[]>(
        "SELECT * FROM agent_rewards WHERE idempotency_key=?",
        [idempotencyKey],
      );
      if (existing.length) {
        const r = existing[0];
        if (
          r.kind !== "BONUS" ||
          r.agent_id !== agentId ||
          r.period !== period ||
          Number(r.amount) !== amount ||
          r.reason !== reason
        )
          throw new HttpError(
            409,
            "This submission key was used with different bonus details",
          );
        await conn.commit();
        res.json({ data: { id: r.id, reused: true } });
        return;
      }
      const [result] = await conn.execute<any>(
        "INSERT INTO agent_rewards(agent_id,period,kind,amount,reason,approved_by,idempotency_key) VALUES(?,?,'BONUS',?,?,?,?)",
        [agentId, period, amount, reason, req.user!.id, idempotencyKey],
      );
      await conn.commit();
      res.status(201).json({ data: { id: result.insertId, reused: false } });
    } catch (error: any) {
      await conn.rollback();
      next(
        error.code === "ER_DUP_ENTRY"
          ? new HttpError(
              409,
              "Submission key already used; reload the reward history",
            )
          : error,
      );
    } finally {
      conn.release();
    }
  },
);
export default router;
