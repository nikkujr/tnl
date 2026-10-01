import { Router } from "express";
import { z } from "zod";
import { db } from "../../database/connection.js";
import { HttpError, validate } from "../../shared/http.js";
import { saleTotalSql } from "../orders/queries.js";
import {
  completedSaleSql,
  currentPeriod,
  monthBounds,
  periodSchema,
} from "./model.js";

const router = Router();
// Mounted after staff authentication and before the admin management routes.
router.get(
  "/agents/:agentId/rewards",
  validate(
    z.object({
      body: z.any(),
      params: z.object({ agentId: z.coerce.number().int().positive() }),
      query: z.object({ month: periodSchema.optional() }),
    }),
  ),
  async (req, res, next) => {
    try {
      const agentId = Number(req.params.agentId);
      if (req.user!.role === "AGENT" && req.user!.id !== agentId)
        throw new HttpError(
          403,
          "You can only view your own incentives and bonuses.",
        );
      const [agents] = await db.query<any[]>(
        "SELECT id FROM users WHERE id=? AND role='AGENT'",
        [agentId],
      );
      if (!agents.length) throw new HttpError(404, "Agent not found");
      const period = String(req.query.month ?? currentPeriod());
      const { start, end } = monthBounds(period);
      const [sales] = await db.query<any[]>(
        `SELECT COALESCE(SUM(${saleTotalSql("o")}),0) sales FROM orders o WHERE o.agent_id=? AND ${completedSaleSql}`,
        [agentId, start, end],
      );
      const [targets] = await db.query<any[]>(
        "SELECT t.sales_target salesTarget,t.incentive_amount incentiveAmount,r.id rewardId FROM agent_targets t LEFT JOIN agent_rewards r ON r.target_id=t.id WHERE t.agent_id=? AND t.period=?",
        [agentId, period],
      );
      const [rows] = await db.query<any[]>(
        "SELECT r.id,r.kind,r.amount,r.reason,r.created_at createdAt,u.full_name approvedBy FROM agent_rewards r JOIN users u ON u.id=r.approved_by WHERE r.agent_id=? AND r.period=? ORDER BY r.id DESC",
        [agentId, period],
      );
      const qualifiedSales = Number(sales[0].sales);
      const target = targets[0];
      const rewards = rows.map((row) => ({
        ...row,
        amount: Number(row.amount),
      }));
      res.json({
        data: {
          period,
          timeZone: "Asia/Manila",
          sales: qualifiedSales,
          target: target
            ? {
                salesTarget: Number(target.salesTarget),
                incentiveAmount: Number(target.incentiveAmount),
                progress:
                  Math.round(
                    (qualifiedSales / Number(target.salesTarget)) * 10000,
                  ) / 100,
                status: target.rewardId
                  ? "APPROVED"
                  : !Number(target.incentiveAmount)
                    ? "NONE"
                    : qualifiedSales >= Number(target.salesTarget)
                      ? "ELIGIBLE"
                      : "IN_PROGRESS",
              }
            : null,
          totals: rewards.reduce(
            (sum, reward) => ({
              incentives:
                sum.incentives +
                (reward.kind === "INCENTIVE" ? reward.amount : 0),
              bonuses:
                sum.bonuses + (reward.kind === "BONUS" ? reward.amount : 0),
            }),
            { incentives: 0, bonuses: 0 },
          ),
          rewards,
        },
      });
    } catch (error) {
      next(error);
    }
  },
);
export default router;
