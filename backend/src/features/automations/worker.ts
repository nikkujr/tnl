import { cleanupPhotos } from "../delivery/photos.js";
import { expireLocationSessions } from "../delivery/service.js";
import { randomUUID, randomBytes } from "node:crypto";
import { db } from "../../database/connection.js";
import { config } from "../../config.js";
import { transaction, jsonValue } from "../../shared/transaction.js";
import { sendEmail } from "../../shared/email.js";
import { renderWorkflowEmail } from "../../shared/email-template.js";
import { enqueue, notify, staffRecipients } from "./events.js";
import { queueCampaign } from "./campaigns.js";
import { paymentEpisode } from "./payment-episode.js";
import { stockEpisode } from "./stock.js";
import { executionFailure } from "./recovery.js";
export const workerId = randomUUID();
const terminal = "'ACCEPTED','SUCCEEDED','FAILED','UNKNOWN','SKIPPED'";
export async function claim() {
  return transaction(async (c) => {
    await c.execute(
      "UPDATE automation_runs SET state=IF(send_started_at IS NULL,'PENDING','UNKNOWN'),last_error='Worker lease expired',lease_owner=NULL,lease_until=NULL WHERE state='PROCESSING' AND lease_until<UTC_TIMESTAMP(6)",
    );
    const [rows] = await c.query<any[]>(
      "SELECT * FROM automation_runs WHERE state='PENDING' AND available_at<=UTC_TIMESTAMP(6) ORDER BY available_at,id LIMIT 1 FOR UPDATE SKIP LOCKED",
    );
    if (!rows[0]) return null;
    const run = rows[0];
    await c.execute(
      "UPDATE automation_runs SET state='PROCESSING',lease_owner=?,lease_until=DATE_ADD(UTC_TIMESTAMP(6),INTERVAL 120 SECOND),attempts=attempts+1 WHERE id=?",
      [workerId, run.id],
    );
    return {
      ...run,
      attempts: run.attempts + 1,
      payload: jsonValue<any>(run.payload),
    };
  });
}
async function finish(
  id: number,
  state: string,
  result: object = {},
  error: string | null = null,
  retryMinutes = 0,
) {
  await db.execute(
    "UPDATE automation_runs SET state=?,result=?,last_error=?,lease_owner=NULL,lease_until=NULL,send_started_at=IF(?='PENDING',NULL,send_started_at),available_at=DATE_ADD(UTC_TIMESTAMP(6),INTERVAL ? MINUTE) WHERE id=? AND lease_owner=? AND state='PROCESSING'",
    [state, JSON.stringify(result), error, state, retryMinutes, id, workerId],
  );
}
export async function execute(run: any) {
  const p = run.payload;
  let sendStarted = false;
  try {
    if (
      !["CAMPAIGN_SEND", "ACCOUNT_EMAIL", "FOLLOWUP_REPLY"].includes(
        run.workflow,
      )
    ) {
      const [settings] = await db.query<any[]>(
        "SELECT enabled FROM automation_settings WHERE workflow=?",
        [run.workflow],
      );
      if (!settings[0]?.enabled) {
        await finish(run.id, "SKIPPED", { reason: "Workflow disabled" });
        return;
      }
    }
    if (p.kind === "STAFF") {
      const result = await transaction(async (c) => {
        let agentId = p.agentId;
        let deliveryEmployeeId: number | null = null;
        if (p.orderId) {
          const [orders] = await c.query<any[]>(
            "SELECT * FROM orders WHERE id=? FOR UPDATE",
            [p.orderId],
          );
          const o = orders[0];
          if (
            !o ||
            !qualifies(run.workflow, o, p.hours) ||
            new Date(o[p.anchorField]).getTime() !==
              new Date(p.anchor).getTime()
          )
            return { reason: "Condition resolved" };
          if (run.workflow === "OUTSTANDING_PAYMENT") {
            const [episodes] = await c.query<any[]>(
              "SELECT active,generation FROM automation_episodes WHERE workflow='OUTSTANDING_PAYMENT' AND entity_id=?",
              [o.id],
            );
            if (!episodes[0]?.active || episodes[0].generation !== p.generation)
              return { reason: "Payment episode resolved" };
          }
          agentId = run.workflow === "PENDING_APPROVAL" ? null : o.agent_id;
          if (run.workflow === "STALLED_DELIVERY") deliveryEmployeeId = o.delivery_employee_id;
        }
        if (p.productId) {
          const [products] = await c.query<any[]>(
            "SELECT active,stock_on_hand-stock_reserved available,low_stock_threshold FROM products WHERE id=? FOR SHARE",
            [p.productId],
          );
          if (
            !products[0]?.active ||
            products[0].available > products[0].low_stock_threshold
          )
            return { reason: "Stock recovered" };
          const [episodes] = await c.query<any[]>(
            "SELECT active,generation FROM automation_episodes WHERE workflow='LOW_STOCK' AND entity_id=?",
            [p.productId],
          );
          if (!episodes[0]?.active || episodes[0].generation !== p.generation)
            return { reason: "Stock episode resolved" };
        }
        await notify(
          c,
          await staffRecipients(c, agentId),
          run.dedupe_key,
          run.workflow,
          p.title,
          p.message,
          p.link,
        );
        if (deliveryEmployeeId) await notify(c,[deliveryEmployeeId],run.dedupe_key,run.workflow,p.title,p.message,`/delivery/${p.orderId}`);
        return {};
      });
      await finish(
        run.id,
        "reason" in result ? "SKIPPED" : "SUCCEEDED",
        result,
      );
      return;
    }
    if (p.authTokenHash) {
      const [tokens] = await db.query<any[]>(
        "SELECT id FROM customer_auth_tokens WHERE token_hash=? AND used_at IS NULL AND expires_at>UTC_TIMESTAMP()",
        [p.authTokenHash],
      );
      if (!tokens.length) {
        await finish(run.id, "SKIPPED", {
          reason: "Account link expired or already used",
        });
        return;
      }
    }
    let to = p.to;
    if (p.customerId) {
      const [rows] = await db.query<any[]>(
        "SELECT email,marketing_opt_in,unsubscribe_token FROM customers WHERE id=?",
        [p.customerId],
      );
      const customer = rows[0];
      if (
        !customer ||
        /@(?:placeholder\.)?tnl\.local$/i.test(customer.email) ||
        (p.marketing && !customer.marketing_opt_in)
      ) {
        await finish(run.id, "SKIPPED", { reason: "Recipient ineligible" });
        return;
      }
      to = customer.email;
      if (p.marketing) {
        if (!customer.unsubscribe_token) {
          const token = randomBytes(32).toString("hex");
          await db.execute(
            "UPDATE customers SET unsubscribe_token=COALESCE(unsubscribe_token,?) WHERE id=?",
            [token, p.customerId],
          );
          const [updated] = await db.query<any[]>(
            "SELECT unsubscribe_token FROM customers WHERE id=?",
            [p.customerId],
          );
          customer.unsubscribe_token = updated[0].unsubscribe_token;
        }
        p.unsubscribe = `${config.PUBLIC_APP_URL}/portal?unsubscribe=${customer.unsubscribe_token}`;
      }
    }
    if (p.orderId) {
      const [orders] = await db.query<any[]>(
        "SELECT id FROM orders WHERE id=?",
        [p.orderId],
      );
      if (!orders.length) {
        await finish(run.id, "SKIPPED", { reason: "Order removed" });
        return;
      }
    }
    const { subject, text, html } = renderWorkflowEmail(
      p,
      run.workflow,
      config.PUBLIC_APP_URL,
    );
    if (!config.SMTP_HOST || !config.SMTP_FROM) {
      await finish(run.id, "FAILED", {}, "SMTP is not configured");
      return;
    }
    const [started] = await db.execute<any>(
      "UPDATE automation_runs SET send_started_at=UTC_TIMESTAMP(6) WHERE id=? AND state='PROCESSING' AND lease_owner=? AND lease_until>UTC_TIMESTAMP(6)",
      [run.id, workerId],
    );
    if (!started.affectedRows) return;
    sendStarted = true;
    const info = await sendEmail(to, subject, text, html);
    if (!info.accepted.length) {
      await finish(
        run.id,
        "FAILED",
        { rejected: info.rejected },
        "SMTP rejected the recipient",
      );
      return;
    }
    await finish(run.id, "ACCEPTED", {
      messageId: info.messageId,
      accepted: info.accepted,
      rejected: info.rejected,
      delivery: "SMTP acceptance; inbox delivery is unconfirmed",
    });
  } catch (error: any) {
    const outcome = executionFailure(error, sendStarted),
      retry = outcome === "RETRY" && run.attempts < 5;
    await finish(
      run.id,
      retry ? "PENDING" : outcome === "RETRY" ? "FAILED" : outcome,
      {},
      String(error.message ?? error).slice(0, 1000),
      [1, 5, 15, 60][Math.min(run.attempts - 1, 3)] ?? 60,
    );
  }
}
function qualifies(workflow: string, o: any, hours: number) {
  if (o.origin !== "LIVE" || o.sales_version !== "PACKAGE") return false;
  const older = (date: any) =>
    date && new Date(date).getTime() <= Date.now() - hours * 3600000;
  if (workflow === "PENDING_APPROVAL")
    return o.order_status === "PENDING" && older(o.created_at);
  if (workflow === "OUTSTANDING_PAYMENT")
    return (
      ["APPROVED", "COMPLETED"].includes(o.order_status) &&
      o.payment_status !== "PAID" &&
      older(o.approved_at)
    );
  return (
    workflow === "STALLED_DELIVERY" &&
    o.order_status === "APPROVED" &&
    o.delivery_status !== "DELIVERED" &&
    older(o.delivery_changed_at)
  );
}
export async function scan() {
  await transaction(expireLocationSessions);
  await cleanupPhotos();
  await transaction(async (c) => {
    await c.execute(
      "INSERT IGNORE INTO worker_heartbeats(id,last_seen_at) VALUES('scheduler',UTC_TIMESTAMP())",
    );
    await c.query(
      "SELECT id FROM worker_heartbeats WHERE id='scheduler' FOR UPDATE",
    );
    const [settings] = await c.query<any[]>(
      "SELECT workflow,config FROM automation_settings WHERE enabled=TRUE",
    );
    for (const setting of settings) {
      const cfg = jsonValue<any>(setting.config),
        wf = setting.workflow;
      if (
        [
          "PENDING_APPROVAL",
          "OUTSTANDING_PAYMENT",
          "STALLED_DELIVERY",
        ].includes(wf)
      ) {
        const [orders] = await c.query<any[]>(
          "SELECT * FROM orders WHERE sales_version='PACKAGE' AND origin='LIVE' AND order_status IN ('PENDING','APPROVED','COMPLETED') ORDER BY id FOR UPDATE",
        );
        const field =
          wf === "PENDING_APPROVAL"
            ? "created_at"
            : wf === "OUTSTANDING_PAYMENT"
              ? "approved_at"
              : "delivery_changed_at";
        for (const o of orders) {
          const generation =
            wf === "OUTSTANDING_PAYMENT" ? await paymentEpisode(c, o.id) : 0;
          if (qualifies(wf, o, cfg.hours)) {
            const anchor = new Date(o[field]).toISOString();
            await enqueue(c, wf, `${wf}:${o.id}:${anchor}:${generation}`, {
              kind: "STAFF",
              orderId: o.id,
              agentId: wf === "PENDING_APPROVAL" ? null : o.agent_id,
              generation,
              hours: cfg.hours,
              anchorField: field,
              anchor,
              title: wf.replaceAll("_", " "),
              message: `${o.tracking_number} requires attention.`,
              link: `/orders/${o.id}`,
            });
          }
        }
      }
      if (wf === "LOW_STOCK") {
        const [products] = await c.query<any[]>(
          "SELECT id FROM products ORDER BY id FOR UPDATE",
        );
        for (const p of products) await stockEpisode(c, p.id);
      }
      if (wf === "SCHEDULED_CAMPAIGN") {
        const [campaigns] = await c.query<any[]>(
          "SELECT id FROM campaigns WHERE status='SCHEDULED' AND scheduled_at<=UTC_TIMESTAMP()",
        );
        for (const campaign of campaigns)
          try {
            await queueCampaign(c, campaign.id, null, true);
          } catch (error: any) {
            await notify(
              c,
              await staffRecipients(c),
              `campaign-attention:${campaign.id}`,
              "CAMPAIGN",
              "Campaign needs attention",
              String(error.message).slice(0, 1000),
              "/campaigns",
            );
          }
      }
    }
    await c.execute(
      `UPDATE campaigns ca SET status='COMPLETED' WHERE ca.status='ACTIVE' AND EXISTS(SELECT 1 FROM campaign_runs cr WHERE cr.campaign_id=ca.id) AND NOT EXISTS(SELECT 1 FROM automation_runs ar WHERE ar.workflow='CAMPAIGN_SEND' AND JSON_EXTRACT(ar.payload,'$.campaignId')=ca.id AND ar.state NOT IN (${terminal}))`,
    );
  });
}
export async function heartbeat(error: string | null = null) {
  await db.execute(
    "INSERT INTO worker_heartbeats(id,last_seen_at,last_error) VALUES(?,UTC_TIMESTAMP(),?) ON DUPLICATE KEY UPDATE last_seen_at=UTC_TIMESTAMP(),last_error=VALUES(last_error)",
    [workerId, error],
  );
}
