import nodemailer from "nodemailer";
import { config } from "../config.js";
import { HttpError } from "./http.js";

const containsHtml = (value: string) => /<\/?[a-z][^>]*>/i.test(value);
const htmlToText = (value: string) =>
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

export const sendCampaignEmail = async (campaign: { name: string; content: string }, recipients: string[]) => {
  if (!config.SMTP_HOST || !config.SMTP_FROM) {
    throw new HttpError(503, "Campaign email is not configured. Set SMTP_HOST and SMTP_FROM.");
  }
  const transporter = nodemailer.createTransport({
    host: config.SMTP_HOST,
    port: config.SMTP_PORT,
    secure: config.SMTP_SECURE,
    auth: config.SMTP_USER ? { user: config.SMTP_USER, pass: config.SMTP_PASSWORD ?? "" } : undefined
  });
  const isHtml = containsHtml(campaign.content);
  const message = {
    from: config.SMTP_FROM,
    to: config.SMTP_FROM,
    bcc: recipients,
    subject: campaign.name,
    ...(isHtml
      ? { html: campaign.content, text: htmlToText(campaign.content) }
      : { text: campaign.content })
  };
  const result = await transporter.sendMail(message);
  return { messageId: result.messageId, recipientCount: recipients.length, contentType: isHtml ? "text/html" : "text/plain" };
};
