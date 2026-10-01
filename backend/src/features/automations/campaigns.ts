import type { PoolConnection } from "mysql2/promise";
import { HttpError } from "../../shared/http.js";
import { jsonValue } from "../../shared/transaction.js";
import { enqueue, event } from "./events.js";
export async function campaignRecipients(
  c: Pick<PoolConnection, "query">,
  campaign: any,
) {
  const ids = jsonValue<number[]>(campaign.customer_ids ?? []);
  if (campaign.audience_type === "SELECTED" && !ids.length) return [];
  const [rows] = await c.query<any[]>(
    `SELECT id,LOWER(email) email,full_name fullName FROM customers WHERE marketing_opt_in=TRUE AND email NOT LIKE '%@placeholder.tnl.local' AND email NOT LIKE '%@tnl.local'${campaign.audience_type === "SELECTED" ? ` AND id IN (${ids.map(() => "?").join(",")})` : ""} ORDER BY id`,
    campaign.audience_type === "SELECTED" ? ids : [],
  );
  const seen = new Set<string>();
  return rows.filter((row) => {
    if (seen.has(row.email)) return false;
    seen.add(row.email);
    return true;
  });
}
export async function queueCampaign(
  c: PoolConnection,
  id: number,
  actor: number | null = null,
  scheduled = false,
) {
  const [rows] = await c.query<any[]>(
    "SELECT * FROM campaigns WHERE id=? FOR UPDATE",
    [id],
  );
  const campaign = rows[0];
  if (!campaign) throw new HttpError(404, "Campaign not found");
  const [existing] = await c.query<any[]>(
    "SELECT id,recipient_count recipientCount FROM campaign_runs WHERE campaign_id=?",
    [id],
  );
  if (existing[0]) return { ...existing[0], reused: true };
  if (scheduled && campaign.status !== "SCHEDULED") return null;
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const date = (v: any) =>
    v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);
  if (today < date(campaign.start_date) || today > date(campaign.end_date))
    throw new HttpError(409, "Campaign is outside its business date window");
  const recipients = await campaignRecipients(c, campaign);
  if (!recipients.length)
    throw new HttpError(409, "No opted-in customers match this audience");
  const [r] = await c.execute<any>(
    "INSERT INTO campaign_runs(campaign_id,recipient_count,content_snapshot) VALUES(?,?,?)",
    [
      id,
      recipients.length,
      JSON.stringify({ name: campaign.name, content: campaign.content }),
    ],
  );
  const eventId = await event(
    c,
    "campaign.queued",
    "CAMPAIGN",
    id,
    { recipientCount: recipients.length },
    actor,
  );
  for (const customer of recipients)
    await enqueue(
      c,
      "CAMPAIGN_SEND",
      `campaign:${id}:customer:${customer.id}`,
      {
        kind: "EMAIL",
        marketing: true,
        customerId: customer.id,
        campaignId: id,
        subject: campaign.name,
        content: campaign.content,
      },
      new Date(),
      eventId,
      true,
    );
  await c.execute("UPDATE campaigns SET status='ACTIVE' WHERE id=?", [id]);
  return { id: r.insertId, recipientCount: recipients.length, reused: false };
}
