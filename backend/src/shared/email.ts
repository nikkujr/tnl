import nodemailer from "nodemailer";
import { config } from "../config.js";
import { HttpError } from "./http.js";

export { htmlToText, containsHtml } from "./email-template.js";

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
