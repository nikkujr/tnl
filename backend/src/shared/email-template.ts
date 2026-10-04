export const containsHtml = (value: string) => /<\/?[a-z][^>]*>/i.test(value);
export const htmlToText = (value: string) =>
  value
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;/gi, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
export const escapeHtml = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ]!,
  );
const render = (template: string, vars: Record<string, unknown>) =>
  template.replace(/\{\{(\w+)\}\}/g, (_, key) => String(vars[key] ?? ""));
const humanize = (value: string) =>
  value
    .toLowerCase()
    .replaceAll("_", " ")
    .replace(/^\w/, (letter) => letter.toUpperCase());
function safeUrl(value?: string) {
  try {
    const url = new URL(value ?? "");
    return ["https:", "http:"].includes(url.protocol) &&
      !url.username &&
      !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}
export interface EmailPayload {
  subject?: string;
  text?: string;
  content?: string;
  config?: { subject?: string; template?: string };
  vars?: Record<string, unknown>;
  unsubscribe?: string;
  actionUrl?: string;
  actionLabel?: string;
}

/** Pure renderer shared by outgoing emails and the admin's sample preview. */
export function renderWorkflowEmail(
  payload: EmailPayload,
  workflow: string,
  appUrl: string,
) {
  const vars = { ...payload.vars };
  if (vars.status) vars.status = humanize(String(vars.status));
  const subject =
    payload.subject ??
    render(payload.config?.subject ?? "TNL Track update", vars);
  let text = payload.text ?? render(payload.config?.template ?? "", vars);
  let content = text;
  let rich = false;
  if (payload.content) {
    content = payload.content.replace(
      /<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi,
      "",
    );
    text = htmlToText(content);
    rich = containsHtml(content);
  }
  const portal = safeUrl(`${appUrl.replace(/\/$/, "")}/portal`);
  let actionUrl = safeUrl(payload.actionUrl) ?? portal;
  let actionLabel = payload.actionLabel ?? "Open customer portal";
  if (workflow === "ACCOUNT_EMAIL") {
    // Also support account links already waiting in the durable queue.
    const legacyLink = safeUrl(text.match(/^Open (https?:\/\/\S+)/)?.[1]);
    actionUrl = safeUrl(payload.actionUrl) ?? legacyLink;
    actionLabel =
      payload.actionLabel ??
      (/reset/i.test(subject) ? "Reset password" : "Activate account");
    content = content.replace(/^Open https?:\/\/\S+\s*/, "");
    content = `Use the secure button below to ${/reset/i.test(subject) ? "reset your password" : "activate your customer account"}.\n\n${content}`;
  } else if (workflow === "WELCOME" || workflow === "CAMPAIGN_SEND") {
    actionLabel = "Explore products & packages";
  }
  const unsubscribe = safeUrl(payload.unsubscribe);
  if (actionUrl && !text.includes(actionUrl))
    text += `\n\n${actionLabel}: ${actionUrl}`;
  if (unsubscribe) text += `\n\nUnsubscribe: ${unsubscribe}`;
  const body = rich
    ? content
    : content
        .split(/\n\s*\n/)
        .filter(Boolean)
        .map(
          (paragraph) =>
            `<p style="margin:0 0 18px;font-size:16px;line-height:1.7;color:#514b65;overflow-wrap:anywhere;">${escapeHtml(paragraph).replace(/\n/g, "<br>")}</p>`,
        )
        .join("");
  const label =
    (
      {
        ORDER_UPDATES: "Order update",
        WELCOME: "Welcome to TNL",
        PURCHASE_FOLLOWUP: "Thank you for your purchase",
        ACCOUNT_EMAIL: "Your customer account",
        FOLLOWUP_REPLY: "A reply from your field agent",
        CAMPAIGN_SEND: "From the TNL team",
      } as Record<string, string>
    )[workflow] ?? "Customer update";
  const details = vars.trackingNumber
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;background:#f2effc;border:1px solid #e5dff5;border-radius:12px;"><tr><td style="padding:16px 20px;font-size:12px;line-height:1.7;color:#7167c9;">ORDER NUMBER<br><strong style="font-size:17px;color:#302d4f;">${escapeHtml(String(vars.trackingNumber))}</strong>${vars.status ? `<br><span style="font-size:14px;color:#514b65;">${escapeHtml(String(vars.status))}</span>` : ""}</td></tr></table>`
    : "";
  const html = `<!doctype html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(subject)}</title>
<style>@media(max-width:480px){.email-outer{padding:16px 8px!important}.email-body{padding:28px 20px!important}.email-title{font-size:24px!important}}</style></head>
<body style="margin:0;padding:0;background:#f6f4fc;font-family:Arial,Helvetica,sans-serif;color:#302d4f;">
<div style="display:none;font-size:1px;color:#f6f4fc;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">${escapeHtml(htmlToText(content).slice(0, 150))}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#f6f4fc"><tr><td class="email-outer" align="center" style="padding:40px 16px;">
<!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0"><tr><td><![endif]-->
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;border:1px solid #e5dff5;border-radius:18px;overflow:hidden;">
<tr><td bgcolor="#302d4f" style="padding:24px 28px;border-radius:18px 18px 0 0;">
<table role="presentation" cellpadding="0" cellspacing="0"><tr><td width="44" height="44" align="center" bgcolor="#9188df" style="border-radius:10px;color:#ffffff;font-size:26px;font-weight:bold;">T</td><td style="padding-left:14px;color:#ffffff;"><strong style="font-size:20px;letter-spacing:2px;">TNL TRACK</strong><br><span style="font-size:12px;color:#d3cdeb;line-height:1.8;">Sales &amp; delivery, connected.</span></td></tr></table>
</td></tr><tr><td class="email-body" style="padding:36px 32px;">
<p style="margin:0 0 12px;font-size:11px;font-weight:bold;letter-spacing:1.8px;text-transform:uppercase;color:#7167c9;">${escapeHtml(label)}</p>
<h1 class="email-title" style="margin:0 0 24px;font-size:28px;line-height:1.3;letter-spacing:-0.5px;color:#302d4f;overflow-wrap:anywhere;">${escapeHtml(subject)}</h1>
${details}<div style="font-size:16px;line-height:1.7;color:#514b65;overflow-wrap:anywhere;">${body}</div>
${actionUrl ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:26px 0 8px;"><tr><td align="center" bgcolor="#7167c9" style="border-radius:10px;mso-padding-alt:14px 24px;"><a href="${escapeHtml(actionUrl)}" style="display:inline-block;padding:14px 24px;color:#ffffff;font-size:14px;font-weight:bold;text-decoration:none;border-radius:10px;">${escapeHtml(actionLabel)}</a></td></tr></table><p style="margin:12px 0 0;font-size:12px;line-height:1.6;color:#827a95;">Button not working? <a href="${escapeHtml(actionUrl)}" style="color:#7167c9;text-decoration:underline;">Open this link</a>.</p>` : ""}
</td></tr><tr><td bgcolor="#faf9fd" style="padding:22px 32px;border-top:1px solid #eee9f7;border-radius:0 0 18px 18px;font-size:12px;line-height:1.8;color:#827a95;">
<strong style="color:#514b65;">Your TNL team</strong><br>Keep your orders, deliveries, and customer updates in one place.
${unsubscribe ? `<p style="margin:12px 0 0;">You’re receiving this email because you opted in to TNL updates. <a href="${escapeHtml(unsubscribe)}" style="color:#7167c9;text-decoration:underline;">Unsubscribe</a></p>` : ""}
</td></tr></table>
<!--[if mso]></td></tr></table><![endif]-->
<p style="margin:20px 0 0;color:#827a95;font-size:11px;line-height:1.8;">TNL TRACK &middot; Clear operations. Confident deliveries.</p>
</td></tr></table></body></html>`;
  return { subject, text, html };
}
