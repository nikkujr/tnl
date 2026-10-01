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

export async function sendEmail(
  to: string,
  subject: string,
  text: string,
  html?: string,
) {
  if (!config.SMTP_HOST || !config.SMTP_FROM)
    throw new HttpError(
      503,
      "Email is not configured. Set SMTP_HOST and SMTP_FROM.",
    );
  const transporter = nodemailer.createTransport({
    host: config.SMTP_HOST,
    port: config.SMTP_PORT,
    secure: config.SMTP_SECURE,
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 30000,
    disableFileAccess: true,
    disableUrlAccess: true,
    ...(config.SMTP_USER
      ? { auth: { user: config.SMTP_USER, pass: config.SMTP_PASSWORD ?? "" } }
      : {}),
  });
  return transporter.sendMail({
    from: config.SMTP_FROM,
    to,
    subject,
    text,
    ...(html ? { html } : {}),
  });
}
export { htmlToText, containsHtml };
